import Joi from 'joi';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { idSchema } from '../../../validation/common.js';

const emoji = new RegExp('^\\p{RGI_Emoji}$', 'v');
export const validReaction = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || emoji.test(value));
export const reactionSchema = Joi.object({
  messageId: idSchema,
  emoji: Joi.string()
    .allow('')
    .max(64)
    .required()
    .custom((value, helpers) => (validReaction(value) ? value : helpers.error('any.invalid'))),
});
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function editable(data: unknown) {
  return (
    data == null ||
    (object(data) &&
      (data.reactions == null || object(data.reactions)) &&
      (data.nativeReactionState == null || object(data.nativeReactionState)))
  );
}
export type ReactionScope = {
  targetId: number;
  targetWamid?: string;
  contactId: number;
  recipient: string;
  phoneNumberId: string;
};
export async function reactionTarget(
  tx: Prisma.TransactionClient,
  vendorId: number,
  scope: ReactionScope,
  lock = false,
) {
  if (lock)
    await tx.$queryRaw`SELECT _id FROM whatsapp_message_logs WHERE _id = ${scope.targetId} AND vendors__id = ${vendorId} FOR UPDATE`;
  const row = await tx.whatsappMessageLogs.findFirst({
    where: {
      id: scope.targetId,
      vendorId,
      contactId: scope.contactId,
      contactWaId: scope.recipient,
      wabPhoneNumberId: scope.phoneNumberId,
    },
  });
  const at = row?.messagedAt?.getTime();
  if (
    !row ||
    !row.whatsappMessageId ||
    (scope.targetWamid && scope.targetWamid !== row.whatsappMessageId) ||
    row.type === 'reaction' ||
    ['failed', 'cancelled'].includes(row.status ?? '') ||
    !at ||
    at > Date.now() ||
    at < Date.now() - 30 * 86400000 ||
    !editable(row.data)
  )
    return null;
  if (
    (await tx.whatsappMessageLogs.count({
      where: {
        vendorId,
        wabPhoneNumberId: scope.phoneNumberId,
        whatsappMessageId: row.whatsappMessageId,
      },
    })) !== 1
  )
    return null;
  return row;
}
export async function prepareReaction(
  tx: Prisma.TransactionClient,
  vendorId: number,
  scope: ReactionScope,
) {
  const target = await reactionTarget(tx, vendorId, scope, true);
  if (!target)
    throw new ApiError(
      409,
      'INVALID_REACTION_TARGET',
      'A recent message for this recipient and business number is required',
    );
  const pending = await tx.whatsappMessageLogs.findFirst({
    where: {
      vendorId,
      contactId: scope.contactId,
      type: 'reaction',
      whatsappMessageId: null,
      status: { notIn: ['cancelled', 'failed'] },
      data: { path: ['nativeReaction', 'targetId'], equals: scope.targetId },
    },
  });
  if (pending)
    throw new ApiError(
      409,
      'REACTION_PENDING',
      'Reconcile or finish the previous reaction before changing it',
    );
  return { ...scope, targetWamid: target.whatsappMessageId! };
}
/** Merge under a row lock; callbacks can arrive after a newer reaction was accepted. */
export async function acknowledgeReaction(
  tx: Prisma.TransactionClient,
  vendorId: number,
  scope: ReactionScope,
  messageId: number,
  value: string,
) {
  const target = await reactionTarget(tx, vendorId, scope, true);
  if (!target || !validReaction(value)) return;
  const data = (target.data ?? {}) as Record<string, any>,
    state = data.nativeReactionState ?? {};
  if (Number(state.self?.messageId ?? 0) >= messageId) return;
  const reactions = { ...data.reactions };
  if (value) reactions.self = value;
  else delete reactions.self;
  await tx.whatsappMessageLogs.update({
    where: { id: target.id },
    data: {
      data: {
        ...data,
        reactions,
        nativeReactionState: { ...state, self: { messageId, emoji: value } },
      },
      updatedAt: new Date(),
    },
  });
}
/** Reactions are receipt evidence, not new conversations or service-window messages. */
export async function ingestReaction(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneNumberId: string,
  message: any,
) {
  const value = message.reaction?.emoji,
    wamid = message.reaction?.message_id,
    at = Number(message.timestamp) * 1000;
  if (
    !validReaction(value) ||
    typeof wamid !== 'string' ||
    !Number.isFinite(at) ||
    at <= 0 ||
    at > Date.now() + 300000
  )
    return;
  const targets = await tx.whatsappMessageLogs.findMany({
    where: {
      vendorId,
      whatsappMessageId: wamid,
      contactWaId: message.from,
      wabPhoneNumberId: phoneNumberId,
      type: { not: 'reaction' },
    },
    take: 2,
  });
  if (targets.length !== 1) return;
  const target = await reactionTarget(
    tx,
    vendorId,
    {
      targetId: targets[0].id,
      contactId: targets[0].contactId,
      recipient: message.from,
      phoneNumberId,
    },
    true,
  );
  if (!target || at < target.messagedAt!.getTime() - 1000) return;
  const contact = await tx.contacts.findFirst({
    where: {
      id: target.contactId,
      vendorId,
      waId: message.from,
      status: 1,
      AND: [
        { OR: [{ platform: 'whatsapp' }, { platform: null }] },
        { OR: [{ wabPhoneNumberId: phoneNumberId }, { wabPhoneNumberId: null }] },
      ],
    },
  });
  if (!contact) return;
  const data = (target.data ?? {}) as Record<string, any>,
    state = data.nativeReactionState ?? {};
  // Same-second conflicts retain the first event; raw competing receipts remain available.
  if (Number(state.contact?.at ?? 0) >= at) return;
  const reactions = { ...data.reactions };
  if (value) reactions.contact = value;
  else delete reactions.contact;
  await tx.whatsappMessageLogs.update({
    where: { id: target.id },
    data: {
      data: {
        ...data,
        reactions,
        nativeReactionState: { ...state, contact: { at, eventId: message.id, emoji: value } },
      },
      updatedAt: new Date(),
    },
  });
}
