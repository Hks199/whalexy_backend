import { db } from '../../../database/client.js';
import { decrypt } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest, providerRequest } from '../../../infrastructure/providers/meta.client.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { config } from '../../../config/environment.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  validateFlowJson,
  validateMetaInputId,
  getFlowAccountContext,
  getOwnedMetaFlow,
  throwMetaFlowResponseError,
} from './meta-flows-support.service.js';

export async function updateMetaFlowDefinition(requestInput: ServiceContext) {
  const definition = validateFlowJson(requestInput.body.flowJson),
    vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { credential, waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId, true);
  const result = await metaOperation(
    requestInput,
    `flow:${flowId}`,
    { action: 'json', definition },
    async (effect) => {
      const current = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
        fields: 'id,status',
      });
      if (current.id !== flowId || current.status !== 'DRAFT')
        throw new ApiError(409, 'FLOW_STATE', 'Only draft flows can be edited');
      const form = new FormData();
      form.set('name', 'flow.json');
      form.set('asset_type', 'FLOW_JSON');
      form.set(
        'file',
        new Blob([JSON.stringify(definition)], { type: 'application/json' }),
        'flow.json',
      );
      const value = await effect(() =>
        providerRequest(
          new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${flowId}/assets`),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${decrypt(credential.secret)}` },
            body: form,
          },
        ),
      );
      if (value.success !== true || !Array.isArray(value.validation_errors))
        throwMetaFlowResponseError();
      return { id: flowId, validationErrors: value.validation_errors };
    },
    async (tx, value) => {
      await tx.nativeMetaFlows.update({
        where: { id: flowId },
        data: {
          flowJson: definition,
          validationErrors: value.validationErrors,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function previewMetaFlow(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId);
  const result = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
    fields: 'id,preview.invalidate(false)',
  });
  if (result.id !== flowId || typeof result.preview?.preview_url !== 'string')
    throwMetaFlowResponseError();
  let url: URL;
  try {
    url = new URL(result.preview.preview_url);
  } catch {
    throwMetaFlowResponseError();
  }
  if (
    url!.protocol !== 'https:' ||
    url!.hostname !== 'business.facebook.com' ||
    url!.username ||
    url!.password ||
    url!.port
  )
    throwMetaFlowResponseError();
  return serviceResult(
    { url: url!.href, expiresAt: result.preview.expires_at ?? null },
    { status: 200, format: 'json' },
  );
}

export async function getMetaFlowDefinition(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = validateMetaInputId(String(requestInput.params.flowId)),
    { credential, waba } = await getFlowAccountContext(vendorId, phone);
  await getOwnedMetaFlow(vendorId, waba, flowId);
  const assets = await metaRequest(vendorId, 'whatsapp', phone, `${flowId}/assets`);
  if (!Array.isArray(assets.data)) throwMetaFlowResponseError();
  const asset = assets.data.find((a: any) => a.asset_type === 'FLOW_JSON');
  let url: URL;
  try {
    url = new URL(asset?.download_url);
  } catch {
    throwMetaFlowResponseError();
  }
  if (
    url!.protocol !== 'https:' ||
    !['lookaside.fbsbx.com', 'graph.facebook.com'].includes(url!.hostname) ||
    url!.username ||
    url!.password ||
    url!.port
  )
    throwMetaFlowResponseError();
  const value = validateFlowJson(
    await providerRequest(url!, {
      headers: { Authorization: `Bearer ${decrypt(credential.secret)}` },
    }),
  );
  await db.nativeMetaFlows.update({
    where: { id: flowId },
    data: { flowJson: value, revision: { increment: 1 }, updatedAt: new Date() },
  });
  return serviceResult(value, { status: 200, format: 'json' });
}
