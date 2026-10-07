import { Prisma, type Contacts } from '@prisma/client';
import { detectEscalation, requestHandoff } from '../../handoffs/services/handoffs.js';
import { queueGraphFlow } from '../../bot-flows/services/bot-graph-runtime.js';
import { withinBotTiming } from '../../bot-flows/services/bot-timing.js';
import { timingNames } from './bot-replies-support.service.js';

/** Linear wildcard matcher avoids regex backtracking on user-defined patterns. */
export function wildcard(pattern: string, text: string) {
  let p = 0,
    t = 0,
    star = -1,
    start = 0;
  while (t < text.length) {
    if (pattern[p] === '*') {
      star = p++;
      start = t;
    } else if (pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++start;
    } else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

export function triggerMatches(
  type: string,
  pattern: string,
  incoming: string,
  first = false,
  activeFlow = false,
) {
  const text = incoming.trim().toLowerCase(),
    trigger = pattern.trim().toLowerCase();
  if (type === 'welcome') return first;
  if (type === 'new_message') return !activeFlow;
  if (!trigger) return false;
  if (['is', 'stop_promotional', 'start_promotional', 'start_ai_bot', 'stop_ai_bot'].includes(type))
    return wildcard(trigger, text);
  if (type === 'starts_with') return text.startsWith(trigger);
  if (type === 'ends_with') return text.endsWith(trigger);
  if (type === 'contains') return text.includes(trigger);
  if (type === 'contains_word')
    return new RegExp(
      `(?<![\\p{L}\\p{N}\\p{M}_])${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}\\p{M}_])`,
      'u',
    ).test(text);
  return false;
}

export async function render(tx: Prisma.TransactionClient, contact: Contacts, text: string) {
  const fields: Record<string, string> = {
    first_name: contact.firstName ?? '',
    last_name: contact.lastName ?? '',
    full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    phone_number: contact.waId ?? '',
    email: contact.email ?? '',
    language_code: contact.languageCode ?? '',
    country: '',
  };
  if (contact.countryId)
    fields.country =
      (await tx.countries.findUnique({ where: { id: contact.countryId }, select: { name: true } }))
        ?.name ?? '';
  const custom = await tx.contactCustomFieldValues.findMany({
    where: { contactId: contact.id, refContactCustomFieldsId: { vendorId: contact.vendorId } },
    include: { refContactCustomFieldsId: true },
    take: 101,
  });
  for (const value of custom)
    fields[value.refContactCustomFieldsId.inputName] = value.fieldValue ?? '';
  const rendered = text.replace(
    /\{([A-Za-z_][\w]*)\}/g,
    (match, key: string) => fields[key] ?? match,
  );
  return rendered.length <= 4096 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rendered)
    ? rendered
    : null;
}

export async function queueText(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  text: string,
  dedupeKey: string,
  metadata: Prisma.InputJsonObject,
) {
  const log = await tx.whatsappMessageLogs.create({
    data: {
      vendorId: contact.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phoneId,
      message: text,
      type: 'text',
      status: 'queued',
      isIncomingMessage: false,
      messagedAt: new Date(),
      data: metadata,
    },
  });
  await tx.outboxJobs.create({
    data: {
      vendorId: contact.vendorId,
      kind: 'whatsapp-send',
      dedupeKey,
      payload: {
        ...metadata,
        messageId: log.id,
        phoneNumberId: phoneId,
        payload: {
          messaging_product: 'whatsapp',
          to: contact.waId,
          type: 'text',
          text: { body: text, preview_url: false },
        },
      },
    },
  });
}

export async function queueBotReplies(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  incomingId: string,
  incomingLogId: number,
  text: string,
  receivedAt: Date,
  at = new Date(),
  suppressReplies = false,
  selection?: string,
) {
  if (
    !contact.waId ||
    !text.trim() ||
    text.length > 4096 ||
    !Number.isFinite(receivedAt.getTime()) ||
    receivedAt.getTime() < at.getTime() - 24 * 3600000 ||
    receivedAt.getTime() > at.getTime() + 300000
  )
    return;
  if (
    (await tx.vendors.findUnique({ where: { id: contact.vendorId }, select: { status: true } }))
      ?.status !== 1
  )
    return;
  const bots = await tx.botReplies.findMany({
    where: { vendorId: contact.vendorId, botFlowsId: null, status: 1 },
    orderBy: [{ priorityIndex: 'asc' }, { id: 'asc' }],
    take: 201,
  });
  // Marketing consent applies even while an away reply or a human handoff owns the conversation.
  for (const bot of bots)
    if (
      ['stop_promotional', 'start_promotional'].includes(bot.triggerType) &&
      (!(bot.data as any)?.phoneNumberId || (bot.data as any).phoneNumberId === phoneId) &&
      (bot.replyTrigger ?? '')
        .split(',')
        .slice(0, 20)
        .some((pattern) => triggerMatches(bot.triggerType, pattern, text))
    ) {
      await tx.contacts.update({
        where: { id: contact.id },
        data: { whatsappOptOut: bot.triggerType === 'stop_promotional' ? 1 : null, updatedAt: at },
      });
      await tx.auditEvents.create({
        data: {
          vendorId: contact.vendorId,
          action: bot.triggerType === 'stop_promotional' ? 'opt-out' : 'opt-in',
          resource: 'contact-marketing',
          resourceId: String(contact.id),
          metadata: { incomingLogId },
        },
      });
    }
  const escalation = detectEscalation(text);
  if (escalation) {
    const result = await requestHandoff(tx, contact, escalation, at);
    if (result.created)
      await queueText(
        tx,
        contact,
        phoneId,
        escalation.reason === 'sensitive_information'
          ? 'For your security, please do not share passwords, OTPs, PINs, CVV numbers, or full card details here. I have paused automated replies and placed your request in the team queue.'
          : 'I have paused automated replies and placed your request in the team queue. A team member will reply here.',
        `handoff:${result.handoff.id}:ack`,
        { handoffAckId: result.handoff.id },
      );
    return;
  }
  if (
    await tx.aiConversationHandoffs.findFirst({
      where: {
        vendorId: contact.vendorId,
        contactId: contact.id,
        status: { in: ['waiting', 'accepted'] },
      },
    })
  )
    return;
  if (suppressReplies) return;
  const flows = await tx.botFlows.findMany({
    where: { vendorId: contact.vendorId },
    select: { id: true },
  });
  const activeFlow = !!(await tx.userActiveFlows.findFirst({
    where: {
      phoneNumber: { in: [contact.waId, `whatsapp:${contact.vendorId}:${contact.waId}`] },
      flowId: { in: flows.map((f) => f.id) },
    },
  }));
  const first = !(await tx.whatsappMessageLogs.findFirst({
    where: {
      vendorId: contact.vendorId,
      contactId: contact.id,
      isIncomingMessage: true,
      id: { not: incomingLogId },
    },
    select: { id: true },
  }));
  const settings = await tx.vendorSettings.findMany({
    where: { vendorId: contact.vendorId, name: { in: timingNames } },
  });
  const values = Object.fromEntries(settings.map((s) => [s.name, s.value]));
  let restricted: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(values.enable_selected_other_bot_timing_restrictions ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) restricted = parsed;
  } catch {
    /* Invalid legacy configuration restricts all automation. */
    if (['1', 'true', 'on'].includes(values.enable_bot_timing_restrictions ?? '')) return;
  }
  const inTime =
    !['1', 'true', 'on'].includes(values.enable_bot_timing_restrictions ?? '') ||
    withinBotTiming(
      at,
      values.bot_timing_timezone ?? 'UTC',
      values.bot_start_timing ?? '',
      values.bot_end_timing ?? '',
    );
  if (
    await queueGraphFlow(
      tx,
      contact,
      phoneId,
      incomingId,
      text,
      selection,
      (type, pattern) => triggerMatches(type, pattern, text, first, activeFlow),
      (type) => inTime || !Object.hasOwn(restricted, type),
      at,
    )
  )
    return;
  if (selection) return;
  let emitted = 0;
  for (const bot of bots) {
    const data = bot.data as any;
    if (
      (data?.phoneNumberId && data.phoneNumberId !== phoneId) ||
      (!inTime && Object.hasOwn(restricted, bot.triggerType))
    )
      continue;
    const patterns = ['welcome', 'new_message'].includes(bot.triggerType)
      ? ['']
      : (bot.replyTrigger ?? '').split(',').slice(0, 20);
    if (
      !patterns.some((pattern) => triggerMatches(bot.triggerType, pattern, text, first, activeFlow))
    )
      continue;
    if (['stop_ai_bot', 'start_ai_bot'].includes(bot.triggerType))
      await tx.contacts.update({
        where: { id: contact.id },
        data: { disableAiBot: bot.triggerType === 'stop_ai_bot' ? 1 : 0, updatedAt: at },
      });
    if (
      emitted >= 20 ||
      [
        'media_message',
        'interaction_message',
        'catalog_message',
        'question',
        'whatsapp_template',
        'whatsapp_flow',
      ].some((key) => data?.[key])
    ) {
      await tx.outboxJobs.create({
        data: {
          vendorId: contact.vendorId,
          kind: 'bot-reply-unsupported',
          status: 'blocked',
          lastError: 'BOT_HANDLER_PENDING',
          dedupeKey: `bot:${incomingId}:${bot.id}`,
          payload: { botReplyId: bot.id, contactId: contact.id },
        },
      });
      continue;
    }
    if (bot.replyText?.trim()) {
      const rendered = await render(tx, contact, bot.replyText);
      if (rendered) {
        await queueText(tx, contact, phoneId, rendered, `bot:${incomingId}:${bot.id}`, {
          botReplyId: bot.id,
          botRevision: bot.updatedAt.toISOString(),
        });
        emitted++;
      } else
        await tx.auditEvents.create({
          data: {
            vendorId: contact.vendorId,
            action: 'blocked',
            resource: 'bot-reply',
            resourceId: String(bot.id),
            metadata: { code: 'BOT_REPLY_TOO_LONG_OR_INVALID', incomingLogId },
          },
        });
    }
  }
}
