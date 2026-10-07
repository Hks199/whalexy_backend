import { authorizeFlow, assertNativeFlow } from './services/flow-access.service.js';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { advanceGraph } from './services/graph-execution.service.js';
import { validateGraph } from './services/graph-schema.validation.js';
import { type BotGraph } from './services/graph-types.types.js';
import { eligibleGraphAgent } from '../handoffs/services/handoffs.js';
import { graphTemplate } from './services/bot-template.js';
import { graphCatalog } from './services/bot-catalog.js';
import { graphMetaFlow } from './services/bot-meta-flow.js';
import { graphQuestionFields } from './services/bot-question.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function owned(tx: Prisma.TransactionClient, vendorId: number, id: number) {
  const flow = await tx.botFlows.findFirst({ where: { id, vendorId } });
  if (!flow) throw new ApiError(404, 'NOT_FOUND', 'Bot flow not found');
  return flow;
}
export async function save(
  tx: Prisma.TransactionClient,
  vendorId: number,
  actorId: number,
  input: any,
  id?: number,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
  if (id) await assertNativeFlow(tx, await owned(tx, vendorId, id));
  const graph = validateGraph(input.graph, input.enabled);
  for (const node of graph.nodes.filter((n) => n.type === 'whatsapp_flow'))
    await graphMetaFlow(tx, vendorId, input.phoneNumberId, node.payload);
  for (const node of graph.nodes.filter((n) => n.type === 'catalog'))
    await graphCatalog(tx, vendorId, input.phoneNumberId, node.payload);
  for (const node of graph.nodes.filter((n) => n.type === 'whatsapp_template'))
    await graphTemplate(tx, vendorId, node.payload);
  await graphQuestionFields(tx, vendorId, graph, 400);
  for (const node of graph.nodes.filter((n) => n.type === 'team_assignment'))
    await eligibleGraphAgent(tx, vendorId, node.payload.assigned_team_member);
  if (
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
  if (!id && (await tx.botFlows.count({ where: { vendorId } })) >= 100)
    throw new ApiError(409, 'FLOW_LIMIT', 'Business flow limit reached');
  const data = {
    title: input.title,
    status: input.enabled ? 'active' : 'inactive',
    triggerType: input.triggerType,
    startTrigger: input.startTrigger,
    channels: ['whatsapp'],
    data: {
      nativeGraphVersion: 1,
      phoneNumberId: input.phoneNumberId,
      graph,
    } as unknown as Prisma.InputJsonObject,
    updatedAt: new Date(),
  };
  const flow = id
    ? await tx.botFlows.update({ where: { id }, data })
    : await tx.botFlows.create({ data: { vendorId, ...data } });
  if (id)
    await tx.userActiveFlows.deleteMany({
      where: { flowId: id, phoneNumber: { startsWith: `node:whatsapp:${vendorId}:` } },
    });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId,
      action: id ? 'update' : 'create',
      resource: 'bot-flow',
      resourceId: String(flow.id),
    },
  });
  return flow;
}
export async function listBotFlows(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  return serviceResult(
    await db.botFlows.findMany({
      where: { vendorId: requestInput.identity!.vendorId! },
      orderBy: { id: 'asc' },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    { status: 200, format: 'json' },
  );
}
export async function createBotFlow(requestInput: ServiceContext) {
  return serviceResult(
    await db.$transaction(async (tx) => {
      await authorizeFlow(tx, requestInput);
      return save(
        tx,
        requestInput.identity!.vendorId!,
        requestInput.identity!.userId,
        requestInput.body,
      );
    }),
    { status: 201, format: 'json' },
  );
}
export async function getBotFlow(requestInput: ServiceContext) {
  return serviceResult(
    await db.$transaction((tx) =>
      owned(tx, requestInput.identity!.vendorId!, Number(requestInput.params.id)),
    ),
    { status: 200, format: 'json' },
  );
}
export async function updateBotFlow(requestInput: ServiceContext) {
  return serviceResult(
    await db.$transaction(async (tx) => {
      await authorizeFlow(tx, requestInput);
      return save(
        tx,
        requestInput.identity!.vendorId!,
        requestInput.identity!.userId,
        requestInput.body,
        Number(requestInput.params.id),
      );
    }),
    { status: 200, format: 'json' },
  );
}
export async function exportBotFlow(requestInput: ServiceContext) {
  const flow = await db.$transaction((tx) =>
      owned(tx, requestInput.identity!.vendorId!, Number(requestInput.params.id)),
    ),
    data = flow.data as any;
  if (data?.nativeGraphVersion !== 1)
    throw new ApiError(409, 'LEGACY_GRAPH_PENDING', 'Legacy builder data requires conversion');
  return serviceResult(
    {
      title: flow.title,
      enabled: false,
      triggerType: flow.triggerType,
      startTrigger: flow.startTrigger ?? '',
      phoneNumberId: data.phoneNumberId,
      graph: data.graph,
    },
    { status: 200, format: 'json' },
  );
}
export async function cloneFlowTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id: number,
  title: string,
) {
  await authorizeFlow(tx, input);
  const vendorId = input.identity!.vendorId!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
  const flow = await owned(tx, vendorId, id),
    data = await assertNativeFlow(tx, flow);
  const graph = structuredClone(data.graph) as BotGraph;
  graph.flow_id = randomUUID();
  return save(tx, vendorId, input.identity!.userId, {
    title,
    enabled: false,
    triggerType: flow.triggerType,
    startTrigger: flow.startTrigger ?? '',
    phoneNumberId: data.phoneNumberId,
    graph,
  });
}
export async function cloneBotFlow(input: ServiceContext) {
  return serviceResult(
    await db.$transaction((tx) =>
      cloneFlowTransaction(tx, input, Number(input.params.id), input.body.title),
    ),
    { status: 201, format: 'json' },
  );
}
export async function previewBotFlow(requestInput: ServiceContext) {
  const flow = await db.$transaction((tx) =>
      owned(tx, requestInput.identity!.vendorId!, Number(requestInput.params.id)),
    ),
    data = flow.data as any;
  if (data?.nativeGraphVersion !== 1)
    throw new ApiError(409, 'LEGACY_GRAPH_PENDING', 'Legacy builder data requires conversion');
  const graph = validateGraph(data.graph, true),
    responses = [];
  let result = advanceGraph(graph, null, {});
  responses.push(result);
  const fields = await db.$transaction((tx) =>
    graphQuestionFields(tx, requestInput.identity!.vendorId!, graph),
  );
  for (const input of requestInput.body.inputs) {
    if (!result.state.nodeId || result.delay) break;
    result = advanceGraph(graph, result.state, {
      ...input,
      fieldType: fields.get(result.state.nodeId)?.inputType,
    });
    responses.push(result);
  }
  return serviceResult(
    { responses, completed: !result.state.nodeId },
    { status: 200, format: 'json' },
  );
}
export async function deleteFlowTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id: number,
) {
  const vendorId = input.identity!.vendorId!;
  await authorizeFlow(tx, input);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(609, ${vendorId}::integer)`;
  await assertNativeFlow(tx, await owned(tx, vendorId, id));
  const scope = `node:whatsapp:${vendorId}:`;
  if (
    await tx.userActiveFlows.count({
      where: {
        flowId: id,
        OR: [{ phoneNumber: null }, { NOT: { phoneNumber: { startsWith: scope } } }],
      },
    })
  )
    throw new ApiError(
      409,
      'FLOW_SESSION_RECONCILIATION_REQUIRED',
      'Imported or foreign sessions must be reconciled before deleting',
    );
  await tx.userActiveFlows.deleteMany({
    where: { flowId: id, phoneNumber: { startsWith: scope } },
  });
  await tx.botFlows.delete({ where: { id } });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId: input.identity!.userId,
      action: 'delete',
      resource: 'bot-flow',
      resourceId: String(id),
    },
  });
}
export async function deleteBotFlow(input: ServiceContext) {
  await db.$transaction((tx) => deleteFlowTransaction(tx, input, Number(input.params.id)));
  return serviceResult(undefined, { status: 204, format: 'end' });
}
