import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
export type ReplyScope = {
  targetId: number;
  targetWamid: string;
  contactId: number;
  recipient: string;
  phoneNumberId: string;
};
export async function replyTarget(
  tx: Prisma.TransactionClient,
  vendorId: number,
  scope: ReplyScope,
) {
  const targets = await tx.whatsappMessageLogs.findMany({
    where: {
      vendorId,
      wabPhoneNumberId: scope.phoneNumberId,
      whatsappMessageId: scope.targetWamid,
    },
    take: 2,
  });
  const row = targets[0];
  return targets.length === 1 &&
    row.id === scope.targetId &&
    row.contactId === scope.contactId &&
    row.contactWaId === scope.recipient &&
    row.type !== 'reaction' &&
    !['failed', 'cancelled', 'uncertain'].includes(row.status ?? '')
    ? row
    : null;
}
export async function prepareReply(
  tx: Prisma.TransactionClient,
  vendorId: number,
  input: Omit<ReplyScope, 'targetId'>,
) {
  const rows = await tx.whatsappMessageLogs.findMany({
    where: {
      vendorId,
      contactId: input.contactId,
      wabPhoneNumberId: input.phoneNumberId,
      whatsappMessageId: input.targetWamid,
    },
    take: 2,
    select: { id: true },
  });
  if (rows.length !== 1)
    throw new ApiError(
      409,
      'INVALID_REPLY_TARGET',
      'An unambiguous delivered message in this conversation is required',
    );
  const scope = { ...input, targetId: rows[0].id };
  await tx.$queryRaw`SELECT _id FROM whatsapp_message_logs WHERE _id = ${scope.targetId} AND vendors__id = ${vendorId} FOR UPDATE`;
  const target = await replyTarget(tx, vendorId, scope);
  if (!target)
    throw new ApiError(
      409,
      'INVALID_REPLY_TARGET',
      'Quoted message is unavailable for this recipient and sender',
    );
  return { scope, uid: target.uid };
}
