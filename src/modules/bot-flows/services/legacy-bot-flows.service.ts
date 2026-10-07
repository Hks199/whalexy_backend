import { Prisma, type BotFlows } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { definition } from '../bot-flows.validation.js';
import { save, cloneFlowTransaction, deleteFlowTransaction } from '../bot-flows.service.js';
import { authorizeFlow, assertNativeFlow } from './flow-access.service.js';
import { validateGraph } from './graph-schema.validation.js';
function projection(flow: BotFlows) {
  return {
    _id: flow.id,
    _uid: flow.uid,
    title: flow.title,
    trigger_type: flow.triggerType,
    start_trigger: flow.startTrigger,
    status: flow.status,
    channels: Array.isArray(flow.channels)
      ? flow.channels.filter((c) => ['whatsapp', 'facebook', 'instagram'].includes(String(c)))
      : [],
    created_at: flow.createdAt.toISOString(),
    updated_at: flow.updatedAt.toISOString(),
  };
}
async function find(tx: Prisma.TransactionClient, input: ServiceContext) {
  const target = input.params.botFlowIdOrUid ?? input.body.botFlowIdOrUid;
  const row = await tx.botFlows.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      ...(/^\d+$/.test(target) ? { id: Number(target) } : { uid: target }),
    },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Bot flow not found');
  return row;
}
export async function read(input: ServiceContext, exporting: boolean) {
  const response = await db.$transaction(
    async (tx) => {
      await authorizeFlow(tx, input);
      const flow = await find(tx, input);
      if (!exporting) return { reaction: 1, message: '', data: projection(flow) };
      const data = await assertNativeFlow(tx, flow),
        checked = definition.validate({
          title: flow.title,
          enabled: false,
          triggerType: flow.triggerType,
          startTrigger: flow.startTrigger ?? '',
          phoneNumberId: data.phoneNumberId,
          graph: validateGraph(data.graph, false),
        });
      if (checked.error)
        throw new ApiError(
          409,
          'LEGACY_GRAPH_PENDING',
          'Flow configuration requires reconciliation',
        );
      return checked.value;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult(response, {
    status: 200,
    format: 'json',
    ...(exporting
      ? { headers: { 'Content-Disposition': 'attachment; filename="bot-flow.json"' } }
      : {}),
  });
}
export async function list(input: ServiceContext) {
  const q = input.validatedQuery;
  if (q.columns?.some((c: any) => c.search?.value))
    throw new ApiError(
      400,
      'UNSUPPORTED_COLUMN_SEARCH',
      'Column-specific search requires frontend reconciliation',
    );
  let orderBy: Prisma.BotFlowsOrderByWithRelationInput[] = [{ id: 'asc' }];
  if (q.order?.length) {
    const order = q.order[0],
      column = q.columns?.[order.column],
      fields: Record<string, string> = {
        _id: 'id',
        _uid: 'uid',
        title: 'title',
        trigger_type: 'triggerType',
        start_trigger: 'startTrigger',
        status: 'status',
        created_at: 'createdAt',
        updated_at: 'updatedAt',
      },
      field = column && fields[column.data];
    if (typeof field !== 'string' || column.orderable === false)
      throw new ApiError(400, 'INVALID_SORT', 'Select a supported source column');
    orderBy = [{ [field]: order.dir }, { id: 'asc' }];
  }
  const result = await db.$transaction(
    async (tx) => {
      await authorizeFlow(tx, input);
      const base = { vendorId: input.identity!.vendorId! },
        term = q.search?.value?.replace(/[\\%_]/g, '\\$&');
      const where: Prisma.BotFlowsWhereInput = {
        ...base,
        ...(term
          ? {
              OR: ['title', 'startTrigger', 'triggerType'].map((field) => ({
                [field]: { contains: term, mode: 'insensitive' },
              })),
            }
          : {}),
      };
      const [recordsTotal, recordsFiltered, rows] = await Promise.all([
        tx.botFlows.count({ where: base }),
        tx.botFlows.count({ where }),
        tx.botFlows.findMany({ where, orderBy, skip: q.start, take: q.length }),
      ]);
      return { draw: q.draw, recordsTotal, recordsFiltered, data: rows.map(projection) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function mutate(input: ServiceContext, action: 'clone' | 'delete' | 'update') {
  const vendorId = input.identity!.vendorId!,
    key = input.headers['idempotency-key'],
    body = input.body;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const hash = digest(
    JSON.stringify({
      action,
      target: input.params.botFlowIdOrUid ?? body.botFlowIdOrUid,
      title: body.title,
      triggerType: body.trigger_type,
      startTrigger: body.start_trigger,
      enabled: [true, 'on', '1', 1].includes(body.status),
    }),
  );
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeFlow(tx, input);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
        const replay = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: `legacy-bot-flows:${key}` } },
        });
        if (replay) {
          if (replay.requestHash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for a different flow action',
            );
          return replay.response;
        }
        const flow = await find(tx, input),
          data = await assertNativeFlow(tx, flow);
        let responseData: unknown = { botFlowUid: flow.uid };
        if (action === 'delete') await deleteFlowTransaction(tx, input, flow.id);
        else if (action === 'clone') {
          const copy = await cloneFlowTransaction(
            tx,
            input,
            flow.id,
            `${flow.title.slice(0, 143)} - Copy`,
          );
          responseData = { botFlowUid: copy.uid, ...projection(copy) };
        } else {
          const checked = definition.validate({
            title: body.title,
            enabled: [true, 'on', '1', 1].includes(body.status),
            triggerType: body.trigger_type,
            startTrigger: body.start_trigger ?? '',
            phoneNumberId: data.phoneNumberId,
            graph: data.graph,
          });
          if (checked.error)
            throw new ApiError(
              400,
              'INVALID_FLOW',
              'Flow header does not satisfy the supported native contract',
            );
          const updated = await save(tx, vendorId, input.identity!.userId, checked.value, flow.id);
          responseData = projection(updated);
        }
        const response = {
          reaction: 1,
          message: `Bot flow ${action === 'clone' ? 'cloned' : action === 'delete' ? 'deleted' : 'updated'} successfully`,
          data: responseData,
        };
        await tx.nativeIdempotency.create({
          data: {
            vendorId,
            key: `legacy-bot-flows:${key}`,
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
        throw new ApiError(409, 'FLOW_CONFLICT', 'Flow changed; retry the same idempotent request');
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
