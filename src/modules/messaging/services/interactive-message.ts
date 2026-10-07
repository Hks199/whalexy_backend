import Joi from 'joi';
import type { Contacts, Prisma } from '@prisma/client';
import { digest, opaqueToken } from '../../../utils/crypto.js';
import { mediaUrlSchema, publicMediaUrl } from './media-message.js';

const label = (max: number) =>
  Joi.string()
    .trim()
    .min(1)
    .max(max)
    .pattern(/^[^\x00-\x1f\x7f]+$/);
/** A browser destination can contain a fragment; never fetch or expand it. */
export const ctaUrlSchema = Joi.string()
  .max(2048)
  .custom((value, helpers) => {
    try {
      const url = new URL(value);
      url.hash = '';
      return /^https:\/\//i.test(value) &&
        !/[\x00-\x20\x7f{}\\]/.test(value) &&
        publicMediaUrl(url.href)
        ? value
        : helpers.error('any.invalid');
    } catch {
      return helpers.error('any.invalid');
    }
  });
export const ctaLabelSchema = label(20);
const id = Joi.string().pattern(/^[A-Za-z0-9_-]{1,64}$/);
const button = Joi.object({ id: id.required(), title: label(20).required() });
const row = Joi.object({ id: id.required(), title: label(24).required(), description: label(72) });
const header = Joi.object({
  type: Joi.string().valid('text', 'image', 'video', 'document').required(),
  text: Joi.when('type', { is: 'text', then: label(60).required(), otherwise: Joi.forbidden() }),
  url: Joi.when('type', {
    is: 'text',
    then: Joi.forbidden(),
    otherwise: mediaUrlSchema.required(),
  }),
  filename: Joi.when('type', {
    is: 'document',
    then: label(240)
      .pattern(/^[^\\/]+$/)
      .invalid('.', '..'),
    otherwise: Joi.forbidden(),
  }),
});
export const interactiveMessageSchema = Joi.object({
  type: Joi.string().valid('button', 'list', 'cta_url', 'location_request_message').required(),
  body: Joi.string()
    .trim()
    .min(1)
    .max(1024)
    .pattern(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+$/)
    .required(),
  header,
  footer: label(60),
  buttons: Joi.when('type', {
    is: 'button',
    then: Joi.array().items(button).min(1).max(3).unique('id').unique('title').required(),
    otherwise: Joi.forbidden(),
  }),
  buttonText: Joi.when('type', {
    is: 'list',
    then: label(20).required(),
    otherwise: Joi.forbidden(),
  }),
  sections: Joi.when('type', {
    is: 'list',
    then: Joi.array()
      .items(
        Joi.object({
          title: label(24).required(),
          rows: Joi.array().items(row).min(1).max(10).required(),
        }),
      )
      .min(1)
      .max(10)
      .required(),
    otherwise: Joi.forbidden(),
  }),
  cta: Joi.when('type', {
    is: 'cta_url',
    then: Joi.object({ title: ctaLabelSchema.required(), url: ctaUrlSchema.required() }).required(),
    otherwise: Joi.forbidden(),
  }),
}).custom((value, helpers) => {
  if (value.type === 'location_request_message' && (value.header || value.footer))
    return helpers.error('any.invalid');
  if (value.type !== 'list') return value;
  const rows = value.sections.flatMap((section: any) => section.rows);
  return rows.length > 10 ||
    new Set(rows.map((r: any) => r.id)).size !== rows.length ||
    (value.header && value.header.type !== 'text')
    ? helpers.error('any.invalid')
    : value;
});
export function interactiveContent(value: any) {
  const expiresAt = Date.now() + 86400000;
  const choices: {
    tokenHash: string;
    choiceId: string;
    title: string;
    type: string;
  }[] = [];
  const choice = (item: any) => {
    const token = `ni_${opaqueToken()}`;
    choices.push({
      tokenHash: digest(token),
      choiceId: item.id,
      title: item.title,
      type: value.type,
    });
    return { ...item, id: token };
  };
  const action =
    value.type === 'cta_url'
      ? { name: 'cta_url', parameters: { display_text: value.cta.title, url: value.cta.url } }
      : value.type === 'location_request_message'
        ? { name: 'send_location' }
        : value.type === 'button'
          ? { buttons: value.buttons.map((item: any) => ({ type: 'reply', reply: choice(item) })) }
          : {
              button: value.buttonText,
              sections: value.sections.map((section: any) => ({
                title: section.title,
                rows: section.rows.map(choice),
              })),
            };
  const h = value.header;
  const interactive = {
    type: value.type,
    body: { text: value.body },
    ...(value.footer ? { footer: { text: value.footer } } : {}),
    ...(h
      ? {
          header:
            h.type === 'text'
              ? { type: 'text', text: h.text }
              : {
                  type: h.type,
                  [h.type]: { link: h.url, ...(h.filename ? { filename: h.filename } : {}) },
                },
        }
      : {}),
    action,
  };
  return { content: { type: 'interactive', interactive }, choices, expiresAt };
}
/** Signed intake and the participant lock are held by the caller. Choices do
 * not run bot actions; opaque IDs cannot be confused with graph menu IDs. */
export async function recordInteractiveChoice(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  incomingId: number,
  message: any,
  at: Date,
) {
  const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (typeof reply?.id !== 'string' || !/^ni_[A-Za-z0-9_-]{64}$/.test(reply.id)) return false;
  const proof = await tx.nativeIdempotency.findUnique({
    where: {
      vendorId_key: { vendorId: contact.vendorId, key: `interactive-choice:${digest(reply.id)}` },
    },
  });
  const state = proof?.response as any;
  if (
    !state ||
    state.contactId !== contact.id ||
    state.recipient !== contact.waId ||
    state.phoneNumberId !== phoneId ||
    state.expiresAt <= Date.now() ||
    at.getTime() <= 0 ||
    at.getTime() > state.expiresAt ||
    contact.status !== 1 ||
    (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== phoneId)
  )
    return false;
  if (
    state.type === 'button' ? !message.interactive?.button_reply : !message.interactive?.list_reply
  )
    return false;
  const original = await tx.whatsappMessageLogs.findFirst({
    where: {
      id: state.messageId,
      vendorId: contact.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phoneId,
      isIncomingMessage: false,
      type: 'interactive',
      status: { notIn: ['cancelled', 'failed'] },
    },
  });
  if (
    !original ||
    (original.whatsappMessageId &&
      message.context?.id &&
      original.whatsappMessageId !== message.context.id)
  )
    return false;
  const incoming = await tx.whatsappMessageLogs.findUniqueOrThrow({
    where: { id: incomingId },
    select: { data: true },
  });
  await tx.whatsappMessageLogs.update({
    where: { id: incomingId },
    data: {
      message: state.title,
      data: {
        ...((incoming.data as Prisma.InputJsonObject) ?? {}),
        nativeInteractiveSelection: {
          messageId: original.id,
          choiceId: state.choiceId,
          title: state.title,
          type: state.type,
        },
      },
    },
  });
  return true;
}
