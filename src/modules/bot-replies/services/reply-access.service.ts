import type { BotReplies, Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';

export async function authorizeReplies(tx: Prisma.TransactionClient, input: ServiceContext) {
  const permissions = await currentContactPermissions(tx, input);
  if (!permissions.includes('*') && !permissions.includes('vendor.bot.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'Current bot management permission required');
}

/** Plain replies must never overwrite imported flow or provider configuration. */
export function assertPlainReply(bot: BotReplies) {
  const data = bot.data;
  if (
    bot.botFlowsId !== null ||
    bot.botRepliesId !== null ||
    (data !== null &&
      (typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).some((key) => key !== 'phoneNumberId')))
  )
    throw new ApiError(
      409,
      'BOT_RECONCILIATION_REQUIRED',
      'Use the corresponding flow or rich bot workflow before editing this reply',
    );
}

export async function deleteReply(tx: Prisma.TransactionClient, input: ServiceContext, id: number) {
  await authorizeReplies(tx, input);
  const vendorId = input.identity!.vendorId!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
  const bot = await tx.botReplies.findFirst({ where: { id, vendorId, botFlowsId: null } });
  if (!bot) throw new ApiError(404, 'NOT_FOUND', 'Bot reply not found');
  assertPlainReply(bot);
  if (await tx.botReplies.count({ where: { botRepliesId: id } }))
    throw new ApiError(409, 'BOT_REFERENCED', 'Reconcile dependent bot replies before deleting');
  await tx.botReplies.delete({ where: { id } });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId: input.identity!.userId,
      action: 'delete',
      resource: 'bot-reply',
      resourceId: String(id),
    },
  });
}
