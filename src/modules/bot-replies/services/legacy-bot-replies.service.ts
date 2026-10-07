import { randomUUID } from 'node:crypto';
import { Prisma, type BotReplies } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { ruleSchema } from '../bot-replies.validation.js';
import { authorizeReplies, assertPlainReply, deleteReply } from './reply-access.service.js';
import { save } from './bot-replies-support.service.js';
import { lockFieldDefinitions } from '../../contacts/services/contact-values.js';

function projection(bot: BotReplies) {
  return {
    _id: bot.id,
    _uid: bot.uid,
    name: bot.name,
    reply_text: bot.replyText,
    reply_trigger: bot.replyTrigger,
    trigger_type: bot.triggerType,
    status: bot.status,
    created_at: bot.createdAt.toISOString(),
    updated_at: bot.updatedAt.toISOString(),
  };
}
function envelope(data: unknown, message = '') {
  return { reaction: 1, message, data };
}
async function find(tx: Prisma.TransactionClient, input: ServiceContext) {
  const target = input.params.botReplyIdOrUid ?? input.body.botReplyIdOrUid;
  const bot = await tx.botReplies.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      botFlowsId: null,
      ...(/^\d+$/.test(target) ? { id: Number(target) } : { uid: target }),
    },
  });
  if (!bot) throw new ApiError(404, 'NOT_FOUND', 'Bot reply not found');
  return bot;
}
export async function edit(input: ServiceContext) {
  const data = await db.$transaction(
    async (tx) => {
      await authorizeReplies(tx, input);
      const bot = await find(tx, input);
      assertPlainReply(bot);
      return {
        ...projection(bot),
        message_type: 'simple',
        phone_number_id: (bot.data as any)?.phoneNumberId ?? null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult(envelope(data), { status: 200, format: 'json' });
}
export async function list(input: ServiceContext) {
  const q = input.validatedQuery;
  if (q.columns?.some((c: any) => c.search?.value))
    throw new ApiError(
      400,
      'UNSUPPORTED_COLUMN_SEARCH',
      'Column-specific search requires frontend reconciliation',
    );
  const fields: Record<string, string> = {
    _id: 'id',
    _uid: 'uid',
    name: 'name',
    reply_text: 'replyText',
    reply_trigger: 'replyTrigger',
    trigger_type: 'triggerType',
    status: 'status',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  let orderBy: Prisma.BotRepliesOrderByWithRelationInput[] = [
    { priorityIndex: 'asc' },
    { id: 'asc' },
  ];
  if (q.order?.length) {
    const order = q.order[0],
      column = q.columns?.[order.column];
    const field = column && fields[column.data];
    if (typeof field !== 'string' || column.orderable === false)
      throw new ApiError(400, 'INVALID_SORT', 'Select a supported sortable source column');
    orderBy = [{ [field]: order.dir }, { id: 'asc' }];
  }
  const result = await db.$transaction(
    async (tx) => {
      await authorizeReplies(tx, input);
      const base = { vendorId: input.identity!.vendorId!, botFlowsId: null };
      const term = q.search?.value?.replace(/[\\%_]/g, '\\$&');
      const where: Prisma.BotRepliesWhereInput = {
        ...base,
        ...(term
          ? {
              OR: ['name', 'replyText', 'replyTrigger', 'triggerType'].map((field) => ({
                [field]: { contains: term, mode: 'insensitive' },
              })),
            }
          : {}),
      };
      const [recordsTotal, recordsFiltered, bots] = await Promise.all([
        tx.botReplies.count({ where: base }),
        tx.botReplies.count({ where }),
        tx.botReplies.findMany({ where, orderBy, skip: q.start, take: q.length }),
      ]);
      return { draw: q.draw, recordsTotal, recordsFiltered, data: bots.map(projection) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function mutate(
  input: ServiceContext,
  action: 'create' | 'update' | 'duplicate' | 'delete',
) {
  const vendorId = input.identity!.vendorId!,
    key = input.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  // Fixed field order makes equivalent submitted objects replay safely.
  const body = input.body;
  const hash = digest(
    JSON.stringify({
      action,
      target: input.params.botReplyIdOrUid ?? body.botReplyIdOrUid ?? null,
      name: body.name,
      triggerType: body.trigger_type,
      replyTrigger: body.reply_trigger,
      replyText: body.reply_text,
      enabled: [true, 'on', '1', 1].includes(body.status),
      phone: body.phone_number_id,
    }),
  );
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeReplies(tx, input);
        await lockFieldDefinitions(tx, vendorId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
        const replay = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: `legacy-bot-replies:${key}` } },
        });
        if (replay) {
          if (replay.requestHash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for a different bot action',
            );
          return replay.response;
        }
        const existing = action === 'create' ? null : await find(tx, input);
        if (existing) assertPlainReply(existing);
        let data: unknown;
        if (action === 'delete') {
          await deleteReply(tx, input, existing!.id);
          data = { botReplyUid: existing!.uid };
        } else {
          const checked = ruleSchema.validate(
            action === 'duplicate'
              ? {
                  name: `${(existing!.name ?? 'Reply').slice(0, 160)}-${randomUUID()}`,
                  replyText: existing!.replyText ?? '',
                  replyTrigger: existing!.replyTrigger,
                  triggerType: existing!.triggerType,
                  enabled: false,
                  phoneNumberId: (existing!.data as any)?.phoneNumberId ?? null,
                }
              : {
                  name: body.name,
                  replyText: body.reply_text,
                  replyTrigger: body.reply_trigger,
                  triggerType: body.trigger_type,
                  enabled: [true, 'on', '1', 1].includes(body.status),
                  phoneNumberId:
                    body.phone_number_id === undefined
                      ? ((existing?.data as any)?.phoneNumberId ?? null)
                      : body.phone_number_id,
                },
          );
          if (checked.error)
            throw new ApiError(
              400,
              'INVALID_BOT_REPLY',
              'Reply does not satisfy the supported text bot contract',
            );
          const saved = await save(
            tx,
            vendorId,
            checked.value,
            input.identity!.userId,
            action === 'update' ? existing!.id : undefined,
          );
          data = projection(saved);
        }
        const response = envelope(
          data,
          `Bot reply ${action === 'create' ? 'created' : action === 'update' ? 'updated' : action === 'duplicate' ? 'duplicated' : 'deleted'}`,
        );
        await tx.nativeIdempotency.create({
          data: {
            vendorId,
            key: `legacy-bot-replies:${key}`,
            requestHash: hash,
            response: response as Prisma.InputJsonObject,
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'BOT_CONFLICT',
          'Bot configuration changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
