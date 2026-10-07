import { db } from '../../../database/client.js';
import { authorizeReplies, deleteReply } from './reply-access.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { save, timingNames } from './bot-replies-support.service.js';

export async function listBotReplies(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  return serviceResult(
    await db.botReplies.findMany({
      where: { vendorId: requestInput.identity!.vendorId!, botFlowsId: null },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: [{ priorityIndex: 'asc' }, { id: 'asc' }],
    }),
    { status: 200, format: 'json' },
  );
}

export async function createBotReply(requestInput: ServiceContext) {
  return serviceResult(
    await db.$transaction(async (tx) => {
      await authorizeReplies(tx, requestInput);
      return save(
        tx,
        requestInput.identity!.vendorId!,
        requestInput.body,
        requestInput.identity!.userId,
      );
    }),
    { status: 201, format: 'json' },
  );
}

export async function updateBotReply(requestInput: ServiceContext) {
  return serviceResult(
    await db.$transaction(async (tx) => {
      await authorizeReplies(tx, requestInput);
      return save(
        tx,
        requestInput.identity!.vendorId!,
        requestInput.body,
        requestInput.identity!.userId,
        Number(requestInput.params.id),
      );
    }),
    { status: 200, format: 'json' },
  );
}

export async function deleteBotReply(requestInput: ServiceContext) {
  await db.$transaction((tx) => deleteReply(tx, requestInput, Number(requestInput.params.id)));
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function updateBotTiming(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    input = requestInput.body,
    values = [
      input.enabled ? '1' : '0',
      input.timezone,
      input.startsAt,
      input.endsAt,
      JSON.stringify(Object.fromEntries(input.triggerTypes.map((type: string) => [type, true]))),
    ];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
    for (let i = 0; i < timingNames.length; i++) {
      const update = await tx.vendorSettings.updateMany({
        where: { vendorId, name: timingNames[i] },
        data: { value: values[i], updatedAt: new Date() },
      });
      if (!update.count)
        await tx.vendorSettings.create({
          data: { vendorId, name: timingNames[i], value: values[i] },
        });
    }
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'configure',
        resource: 'bot-timing',
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
