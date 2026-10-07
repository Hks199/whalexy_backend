import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  getFlowAccountContext,
  flowDetailFields,
  throwMetaFlowResponseError,
  requireMetaId,
  parseMetaFlowSnapshot,
  validateFlowCursor,
  validateMetaInputId,
  getOwnedMetaFlow,
} from './meta-flows-support.service.js';

export async function listMetaFlows(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    { waba } = await getFlowAccountContext(vendorId, phone),
    q = requestInput.validatedQuery;
  const seen = new Set<string>(),
    items: any[] = [];
  let after = q.after,
    pages = 0,
    hasMore = false;
  if (after) seen.add(after);
  while (pages < q.maxPages) {
    const result = await metaRequest(
      vendorId,
      'whatsapp',
      phone,
      `${waba}/flows`,
      'GET',
      undefined,
      { fields: flowDetailFields, limit: '100', ...(after ? { after } : {}) },
    );
    if (!Array.isArray(result.data) || result.data.length > 100) throwMetaFlowResponseError();
    for (const value of result.data) {
      requireMetaId(value.id);
      parseMetaFlowSnapshot(value);
      items.push(value);
    }
    pages++;
    hasMore = Boolean(result.paging?.next);
    if (!hasMore) break;
    after = validateFlowCursor(result, seen);
  }
  await db.$transaction(
    async (tx) => {
      for (const value of items) {
        const prior = await tx.nativeMetaFlows.findUnique({ where: { id: value.id } });
        if (prior && (prior.vendorId !== vendorId || prior.wabaId !== waba))
          throw new ApiError(409, 'FLOW_OWNER_MISMATCH', 'Flow belongs to another business');
        const data = parseMetaFlowSnapshot(value);
        await tx.nativeMetaFlows.upsert({
          where: { id: value.id },
          create: { id: value.id, vendorId, wabaId: waba, ...data },
          update: { ...data, updatedAt: new Date() },
        });
      }
    },
    { timeout: 30000 },
  );
  return serviceResult(
    {
      items: items.map((value) => ({ id: value.id, ...parseMetaFlowSnapshot(value) })),
      pages,
      hasMore,
      nextCursor: hasMore ? after : null,
    },
    { status: hasMore ? 206 : 200, format: 'json' },
  );
}

export async function createMetaFlow(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    { waba } = await getFlowAccountContext(vendorId, phone);
  const result = await metaOperation(
    requestInput,
    `flow-create:${waba}`,
    requestInput.body,
    async (effect) => {
      const value = await effect(() =>
        metaRequest(vendorId, 'whatsapp', phone, `${waba}/flows`, 'POST', requestInput.body),
      );
      return {
        id: requireMetaId(value.id),
        name: requestInput.body.name,
        categories: requestInput.body.categories,
        status: 'DRAFT',
      };
    },
    async (tx, value) => {
      await tx.nativeMetaFlows.create({ data: { ...value, vendorId, wabaId: waba } });
    },
  );
  return serviceResult(result, { status: 201, format: 'json' });
}

export async function getMetaFlow(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId);
  const value = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
    fields: flowDetailFields,
  });
  if (value.id !== flowId) throwMetaFlowResponseError();
  const data = parseMetaFlowSnapshot(value);
  const flow = await db.nativeMetaFlows.update({
    where: { id: flowId },
    data: { ...data, updatedAt: new Date() },
  });
  return serviceResult(flow, { status: 200, format: 'json' });
}

export async function updateMetaFlow(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId, true);
  const result = await metaOperation(
    requestInput,
    `flow:${flowId}`,
    { action: 'metadata', ...requestInput.body },
    async (effect) => {
      const current = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
        fields: 'id,status',
      });
      if (current.id !== flowId || current.status !== 'DRAFT')
        throw new ApiError(409, 'FLOW_STATE', 'Only draft flows can be edited');
      const value = await effect(() =>
        metaRequest(vendorId, 'whatsapp', phone, flowId, 'POST', requestInput.body),
      );
      if (value.success !== true) throwMetaFlowResponseError();
      return { id: flowId, ...requestInput.body };
    },
    async (tx, value) => {
      await tx.nativeMetaFlows.update({
        where: { id: flowId },
        data: {
          name: value.name,
          categories: value.categories,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function changeMetaFlowState(
  requestInput: ServiceContext,
  action: 'delete' | 'deprecate' | 'publish',
) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId, true);
  const result = await metaOperation(
    requestInput,
    `flow:${flowId}`,
    { action },
    async (effect) => {
      const current = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
        fields: flowDetailFields,
      });
      if (current.id !== flowId) throwMetaFlowResponseError();
      parseMetaFlowSnapshot(current);
      const expected = action === 'deprecate' ? 'PUBLISHED' : 'DRAFT';
      if (current.status !== expected)
        throw new ApiError(409, 'FLOW_STATE', `This operation requires a ${expected} flow`);
      if (action === 'publish' && (current.validation_errors ?? []).length)
        throw new ApiError(
          409,
          'FLOW_VALIDATION',
          'Resolve provider validation errors before publishing',
        );
      const value = await effect(() =>
        metaRequest(
          vendorId,
          'whatsapp',
          phone,
          action === 'delete' ? flowId : `${flowId}/${action}`,
          action === 'delete' ? 'DELETE' : 'POST',
          action === 'delete' ? undefined : {},
        ),
      );
      if (value.success !== true) throwMetaFlowResponseError();
      return {
        id: flowId,
        status:
          action === 'publish' ? 'PUBLISHED' : action === 'deprecate' ? 'DEPRECATED' : 'DELETED',
      };
    },
    async (tx, value) => {
      await tx.nativeMetaFlows.update({
        where: { id: flowId },
        data: { status: value.status, revision: { increment: 1 }, updatedAt: new Date() },
      });
      await tx.whatsappFlowLaunchSettings.updateMany({
        where: { vendorId, flowId },
        data: { automationEnabled: false, updatedAt: new Date() },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
