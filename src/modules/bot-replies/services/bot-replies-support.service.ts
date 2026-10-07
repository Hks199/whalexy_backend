import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { lockFieldDefinitions } from '../../contacts/services/contact-values.js';
import { assertPlainReply } from './reply-access.service.js';
import { priorities } from '../bot-replies.validation.js';

export async function save(
  tx: Prisma.TransactionClient,
  vendorId: number,
  input: any,
  actorId: number,
  id?: number,
) {
  await lockFieldDefinitions(tx, vendorId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
  const existing = id
    ? await tx.botReplies.findFirst({ where: { id, vendorId, botFlowsId: null } })
    : null;
  if (id && !existing) throw new ApiError(404, 'NOT_FOUND', 'Bot reply not found');
  if (existing) assertPlainReply(existing);
  if (
    await tx.botReplies.findFirst({
      where: { vendorId, botFlowsId: null, name: input.name, ...(id ? { id: { not: id } } : {}) },
    })
  )
    throw new ApiError(409, 'BOT_NAME_EXISTS', 'Bot name is already used in this business');
  if (!id && (await tx.botReplies.count({ where: { vendorId, botFlowsId: null } })) >= 200)
    throw new ApiError(409, 'BOT_LIMIT', 'Review the existing replies before adding more');
  if (
    input.phoneNumberId &&
    !(await tx.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: {
          vendorId,
          provider: 'whatsapp',
          externalId: input.phoneNumberId,
        },
      },
    }))
  )
    throw new ApiError(400, 'INVALID_PHONE_NUMBER', 'Business number is not connected');
  const data = {
    name: input.name,
    replyText: input.replyText,
    replyTrigger: input.replyTrigger,
    triggerType: input.triggerType,
    status: input.enabled ? 1 : 2,
    priorityIndex: priorities[input.triggerType],
    data: { phoneNumberId: input.phoneNumberId },
    updatedAt: new Date(),
  };
  const bot = id
    ? await tx.botReplies.update({ where: { id }, data })
    : await tx.botReplies.create({ data: { vendorId, ...data } });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId,
      action: id ? 'update' : 'create',
      resource: 'bot-reply',
      resourceId: String(bot.id),
    },
  });
  return bot;
}

export const timingNames = [
  'enable_bot_timing_restrictions',
  'bot_timing_timezone',
  'bot_start_timing',
  'bot_end_timing',
  'enable_selected_other_bot_timing_restrictions',
];
