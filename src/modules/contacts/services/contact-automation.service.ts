import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { aiEntitlementActive } from '../../ai/services/ai-entitlement.service.js';
import { resolveHandoff } from '../../handoffs/services/handoffs.js';
import { aiRequest, aiServiceUrl } from '../../../infrastructure/providers/ai.client.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
async function current(tx: Prisma.TransactionClient, input: ServiceContext, id: number) {
  const permissions = await currentContactPermissions(tx, input),
    has = (p: string) => permissions.includes('*') || permissions.includes(p);
  if (!has('vendor.ai.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'AI management permission required');
  const contact = await tx.contacts.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      id,
      ...(!has('vendor.chats.view_all') ? { assignedUserId: input.identity!.userId } : {}),
    },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  if (contact.status !== 1)
    throw new ApiError(409, 'CONTACT_INACTIVE', 'AI settings require an active contact');
  return contact;
}
export async function changeContactAutomation(input: ServiceContext, toggle = false) {
  const vendorId = input.identity!.vendorId!,
    identifier = input.params.contactIdOrUid ?? Number(input.params.id);
  const row = await db.contacts.findFirst({
    where: {
      vendorId,
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: { id: true },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  await db.$transaction((tx) => current(tx, input, row.id));
  const result = await metaOperation(
    input,
    `conversation-resolution:${row.id}`,
    { contactId: row.id, action: 'automation', enabled: toggle ? null : input.body.enabled },
    async (effect) => {
      const snapshot = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${row.id}::integer)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
        const contact = await current(tx, input, row.id),
          enabled = toggle ? Boolean(contact.disableAiBot) : input.body.enabled;
        if (enabled && !(await aiEntitlementActive(vendorId, tx)))
          throw new ApiError(403, 'AI_ENTITLEMENT_REQUIRED', 'Active AI entitlement required');
        // A requested pause stops local automation even when synchronization is uncertain.
        let version = contact.updatedAt.toISOString();
        if (!enabled && !contact.disableAiBot) {
          const paused = await tx.contacts.update({
            where: { id: row.id },
            data: { disableAiBot: 1, updatedAt: new Date() },
          });
          version = paused.updatedAt.toISOString();
          await tx.auditEvents.create({
            data: {
              vendorId,
              actorId: input.identity!.userId,
              action: 'ai-pause-local',
              resource: 'contact-automation',
              resourceId: String(row.id),
            },
          });
        }
        return { version, recipient: contact.waId, platform: contact.platform, enabled };
      });
      if (!snapshot.recipient || (snapshot.platform && snapshot.platform !== 'whatsapp'))
        throw new ApiError(
          409,
          'AI_RECIPIENT_REQUIRED',
          'AI synchronization requires a WhatsApp recipient',
        );
      aiServiceUrl(vendorId, 'conversations/automation');
      const ack = await effect(() =>
        aiRequest(vendorId, 'conversations/automation', 'POST', {
          customer_phone: snapshot.recipient,
          enabled: snapshot.enabled,
          ...(snapshot.enabled ? { state: 'AI_ACTIVE' } : {}),
        }),
      );
      if (
        !ack ||
        typeof ack !== 'object' ||
        Array.isArray(ack) ||
        ack.success !== true ||
        (ack.enabled !== undefined && ack.enabled !== snapshot.enabled) ||
        ack.status === 'error'
      )
        throw new ApiError(
          502,
          'PROVIDER_UNCERTAIN',
          'AI synchronization acknowledgement requires reconciliation',
        );
      return { ...snapshot, response: null as any };
    },
    async (tx, value) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${row.id}::integer)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
      const contact = await current(tx, input, row.id);
      if (contact.updatedAt.toISOString() !== value.version || contact.waId !== value.recipient)
        throw new ApiError(
          409,
          'AUTOMATION_STATE_CHANGED',
          'Contact changed during synchronization; reconcile the provider operation',
        );
      if (value.enabled && !(await aiEntitlementActive(vendorId, tx)))
        throw new ApiError(
          403,
          'AI_ENTITLEMENT_REQUIRED',
          'AI entitlement changed during synchronization',
        );
      await tx.contacts.update({
        where: { id: row.id },
        data: { disableAiBot: value.enabled ? 0 : 1, updatedAt: new Date() },
      });
      if (value.enabled) await resolveHandoff(tx, vendorId, row.id);
      value.response = {
        contact_uid: contact.uid,
        isAiChatBotEnabled: value.enabled,
        contact: { disable_ai_bot: value.enabled ? 0 : 1 },
      };
    },
  );
  return serviceResult(result.response, { status: 200, format: 'json' });
}
