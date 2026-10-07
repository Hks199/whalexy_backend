import { validateEndpoint } from './endpoint-definition.js';
import { db } from '../../../database/client.js';
import { decrypt } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { providerRequest, metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { config } from '../../../config/environment.js';
import { getFlowAccountContext } from '../../meta-flows/services/meta-flows-support.service.js';
import { numeric } from '../flow-data.validation.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  requireFlowConfigurationOwner,
  getFlowEndpointUrl,
  flowConfigReceiptKey,
} from './flow-data-support.service.js';

export async function configureFlowDataEndpoint(requestInput: ServiceContext) {
  requireFlowConfigurationOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = String(requestInput.params.flowId);
  if (numeric.validate(flowId).error)
    throw new ApiError(400, 'INVALID_FLOW_ID', 'Invalid Flow identifier');
  const { credential, waba } = await getFlowAccountContext(vendorId, phone),
    flow = await db.nativeMetaFlows.findFirst({
      where: { id: flowId, vendorId, wabaId: waba, status: { not: 'DELETED' } },
    });
  if (!flow) throw new ApiError(404, 'NOT_FOUND', 'Owned Flow not found');
  if (!(credential.metadata as any)?.flowEncryption?.active)
    throw new ApiError(409, 'FLOW_KEY_REQUIRED', 'Register this number encryption key first');
  const setup = validateEndpoint(flow.flowJson, requestInput.body),
    uri = getFlowEndpointUrl(credential.id);
  if (new URL(uri).protocol !== 'https:')
    throw new ApiError(
      503,
      'PUBLIC_HTTPS_REQUIRED',
      'Configure PUBLIC_URL with the public HTTPS endpoint',
    );
  const result = await metaOperation(
    requestInput,
    `flow:${flowId}`,
    { action: 'data-endpoint', setup, uri },
    async (effect) => {
      const remote = await metaRequest(vendorId, 'whatsapp', phone, flowId, 'GET', undefined, {
        fields: 'id,status',
      });
      if (remote.id !== flowId || remote.status !== 'DRAFT')
        throw new ApiError(409, 'FLOW_STATE', 'Only draft Flow endpoints can be configured');
      const form = new FormData();
      form.set('endpoint_uri', uri);
      const value = await effect(() =>
        providerRequest(
          new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${flowId}`),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${decrypt(credential.secret)}` },
            body: form,
          },
        ),
      );
      if (value.success !== true)
        throw new ApiError(502, 'PROVIDER_UNCERTAIN', 'Flow endpoint update needs reconciliation');
      return { id: flowId, endpointUri: uri };
    },
    async (tx) => {
      const fresh = await tx.nativeMetaFlows.findFirst({
        where: { id: flowId, vendorId, revision: flow.revision, status: 'DRAFT' },
      });
      if (!fresh)
        throw new ApiError(409, 'FLOW_CHANGED', 'Flow changed during endpoint registration');
      await tx.nativeMetaFlows.update({
        where: { id: flowId },
        data: { endpointUri: uri, revision: { increment: 1 }, updatedAt: new Date() },
      });
      await tx.webhookReceipts.upsert({
        where: { eventKey: flowConfigReceiptKey(vendorId, flowId) },
        create: {
          provider: 'flow-data-config',
          eventKey: flowConfigReceiptKey(vendorId, flowId),
          payload: setup,
        },
        update: { payload: setup },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function getFlowDataEndpoint(requestInput: ServiceContext) {
  requireFlowConfigurationOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    flowId = String(requestInput.params.flowId),
    { credential, waba } = await getFlowAccountContext(vendorId, phone);
  const flow = await db.nativeMetaFlows.findFirst({
    where: { id: flowId, vendorId, wabaId: waba, status: { not: 'DELETED' } },
  });
  if (!flow) throw new ApiError(404, 'NOT_FOUND', 'Flow not found');
  const saved = await db.webhookReceipts.findUnique({
    where: { eventKey: flowConfigReceiptKey(vendorId, flowId) },
  });
  return serviceResult(
    { endpointUri: getFlowEndpointUrl(credential.id), configuration: saved?.payload ?? null },
    { status: 200, format: 'json' },
  );
}
