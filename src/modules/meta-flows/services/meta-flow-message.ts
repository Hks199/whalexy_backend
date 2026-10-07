import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { digest } from '../../../utils/crypto.js';
import { graphFlowProofAllowed } from '../../bot-flows/services/bot-meta-flow.js';

export async function flowMessage(
  vendorId: number,
  phoneNumberId: string,
  flowId: string,
  token: string,
  body: string,
  cta: string,
) {
  const [flow, credential] = await Promise.all([
    db.nativeMetaFlows.findFirst({ where: { id: flowId, vendorId, status: 'PUBLISHED' } }),
    db.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneNumberId },
      },
    }),
  ]);
  if (!flow || !credential || (credential.metadata as any)?.wabaId !== flow.wabaId)
    throw new ApiError(
      404,
      'FLOW_NOT_AVAILABLE',
      'A published flow from this business account is required',
    );
  const remote = await metaRequest(vendorId, 'whatsapp', phoneNumberId, flowId, 'GET', undefined, {
    fields: 'id,status,endpoint_uri,data_api_version',
  });
  if (remote.id !== flowId || remote.status !== 'PUBLISHED')
    throw new ApiError(409, 'FLOW_NOT_AVAILABLE', 'The provider flow is not published');
  const json = flow.flowJson as any,
    endpoint = Boolean(remote.endpoint_uri || remote.data_api_version || json?.data_api_version);
  if (endpoint && !remote.endpoint_uri)
    throw new ApiError(
      409,
      'FLOW_ENDPOINT_REQUIRED',
      'The provider flow needs its configured data endpoint',
    );
  if (!endpoint && typeof json?.screens?.[0]?.id !== 'string')
    throw new ApiError(
      409,
      'FLOW_JSON_REQUIRED',
      'Fetch or upload this flow definition before sending it',
    );
  return {
    revision: flow.revision,
    content: {
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: body },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            flow_token: token,
            flow_cta: cta,
            flow_action: endpoint ? 'data_exchange' : 'navigate',
            ...(!endpoint ? { flow_action_payload: { screen: json.screens[0].id } } : {}),
          },
        },
      },
    },
  };
}
export async function flowSendAllowed(vendorId: number, phoneNumberId: string, value: any) {
  if (!value) return true;
  const [flow, credential] = await Promise.all([
    db.nativeMetaFlows.findFirst({
      where: { id: value.id, vendorId, status: 'PUBLISHED', revision: value.revision },
    }),
    db.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneNumberId },
      },
    }),
  ]);
  if (!flow || !credential || (credential.metadata as any)?.wabaId !== flow.wabaId) return false;
  if (value.credentialId) {
    if (
      credential.id !== value.credentialId ||
      credential.updatedAt.toISOString() !== value.credentialRevision ||
      flow.endpointUri !== value.endpointUri ||
      digest(JSON.stringify(flow.flowJson)) !== value.definitionHash
    )
      return false;
    if (value.setupHash) {
      const setup = await db.webhookReceipts.findUnique({
        where: { eventKey: `flow-data-config:${vendorId}:${flow.id}` },
      });
      if (!setup || digest(JSON.stringify(setup.payload)) !== value.setupHash) return false;
    }
    const proof = await db.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId, key: `flow-token:${value.tokenHash}` } },
      }),
      state = proof?.response as any;
    if (
      !state ||
      state.consumed ||
      state.expiresAt <= Date.now() ||
      !(await db.$transaction((tx) => graphFlowProofAllowed(tx, vendorId, state)))
    )
      return false;
  }
  if (value.verifyRemote) {
    const remote = await metaRequest(
      vendorId,
      'whatsapp',
      phoneNumberId,
      value.id,
      'GET',
      undefined,
      { fields: 'id,status,endpoint_uri,data_api_version,validation_errors,health_status' },
    );
    if (remote.validation_errors !== undefined && !Array.isArray(remote.validation_errors))
      throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid Flow validation response');
    if (
      remote.id !== value.id ||
      remote.status !== 'PUBLISHED' ||
      (remote.validation_errors ?? []).length ||
      remote.health_status?.can_send_message === 'BLOCKED'
    )
      return false;
    if (
      value.endpointUri
        ? remote.endpoint_uri !== value.endpointUri
        : remote.endpoint_uri || remote.data_api_version
    )
      return false;
    return flowSendAllowed(vendorId, phoneNumberId, { ...value, verifyRemote: false });
  }
  return true;
}
