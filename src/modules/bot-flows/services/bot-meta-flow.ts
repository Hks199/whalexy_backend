import type { Contacts, Prisma } from '@prisma/client';
import type { GraphResult } from './graph-types.types.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest, opaqueToken } from '../../../utils/crypto.js';
import { config } from '../../../config/environment.js';
import { validateEndpoint } from '../../flow-data/services/endpoint-definition.js';

export async function graphMetaFlow(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneId: string,
  input: any,
) {
  const flow = await tx.nativeMetaFlows.findFirst({
    where: { id: input.flow_id, vendorId, status: 'PUBLISHED' },
  });
  const credential = await tx.integrationCredentials.findUnique({
    where: {
      vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneId },
    },
  });
  if (
    !flow ||
    !credential ||
    flow.wabaId !== (credential.metadata as any)?.wabaId ||
    (Array.isArray(flow.validationErrors) && flow.validationErrors.length)
  )
    throw new ApiError(
      409,
      'GRAPH_META_FLOW_UNAVAILABLE',
      'An owned published Flow from the sending account is required',
    );
  const json = flow.flowJson as any,
    endpoint = Boolean(flow.endpointUri || json?.data_api_version);
  let setupHash: string | null = null;
  if (endpoint) {
    const expected = `${config.PUBLIC_URL.replace(/\/$/, '')}/webhooks/flows/${credential.id}`;
    const setup = await tx.webhookReceipts.findUnique({
      where: { eventKey: `flow-data-config:${vendorId}:${flow.id}` },
    });
    if (
      !expected.startsWith('https://') ||
      flow.endpointUri !== expected ||
      !(credential.metadata as any)?.flowEncryption?.active?.envelope ||
      !setup
    )
      throw new ApiError(
        409,
        'GRAPH_FLOW_ENDPOINT_UNAVAILABLE',
        'A configured native encrypted data endpoint is required',
      );
    try {
      validateEndpoint(json, setup.payload);
    } catch {
      throw new ApiError(
        409,
        'GRAPH_FLOW_ENDPOINT_UNAVAILABLE',
        'The retained endpoint configuration requires review',
      );
    }
    setupHash = digest(JSON.stringify(setup.payload));
  } else if (
    typeof json?.screens?.[0]?.id !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(json.screens[0].id)
  )
    throw new ApiError(
      409,
      'GRAPH_FLOW_JSON_REQUIRED',
      'Synchronize a valid starting screen before sending',
    );
  return { flow, credential, endpoint, setupHash, definitionHash: digest(JSON.stringify(json)) };
}
export async function prepareGraphMetaFlows(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  result: GraphResult,
): Promise<GraphResult> {
  const messages = [];
  for (const message of result.messages) {
    if (!message.graphMetaFlow) {
      messages.push(message);
      continue;
    }
    const p = message.graphMetaFlow,
      built = await graphMetaFlow(tx, contact.vendorId, phoneId, p),
      token = opaqueToken();
    const interactive: any = {
      type: 'flow',
      body: { text: p.body_text || 'Tap below to continue.' },
      ...(p.header_text ? { header: { type: 'text', text: p.header_text } } : {}),
      ...(p.footer_text ? { footer: { text: p.footer_text } } : {}),
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: p.flow_id,
          flow_token: token,
          flow_cta: p.cta_text || 'Open Flow',
          flow_action: built.endpoint ? 'data_exchange' : 'navigate',
          ...(!built.endpoint
            ? { flow_action_payload: { screen: (built.flow.flowJson as any).screens[0].id } }
            : {}),
        },
      },
    };
    messages.push({
      nodeId: message.nodeId,
      type: 'interactive',
      interactive,
      flowToken: token,
      nativeFlow: {
        id: built.flow.id,
        revision: built.flow.revision,
        credentialId: built.credential.id,
        credentialRevision: built.credential.updatedAt.toISOString(),
        endpointUri: built.flow.endpointUri,
        setupHash: built.setupHash,
        definitionHash: built.definitionHash,
        verifyRemote: true,
        tokenHash: digest(token),
      },
    });
  }
  return { ...result, messages };
}
export async function graphFlowProofAllowed(
  tx: Prisma.TransactionClient,
  vendorId: number,
  value: any,
) {
  if (!value?.graphFlowId) return true;
  if (
    !Number.isInteger(value.graphFlowId) ||
    !Number.isInteger(value.messageId) ||
    !Number.isInteger(value.contactId) ||
    typeof value.flowId !== 'string' ||
    typeof value.credentialId !== 'string'
  )
    return false;
  const [graph, credential, contact, flow, vendor, message] = await Promise.all([
    tx.botFlows.findFirst({ where: { id: value.graphFlowId, vendorId, status: 'active' } }),
    tx.integrationCredentials.findFirst({
      where: {
        id: value.credentialId,
        vendorId,
        provider: 'whatsapp',
        externalId: value.phoneNumberId,
      },
    }),
    tx.contacts.findFirst({ where: { id: value.contactId, vendorId, status: 1 } }),
    tx.nativeMetaFlows.findFirst({
      where: { id: value.flowId, vendorId, status: 'PUBLISHED', revision: value.revision },
    }),
    tx.vendors.findUnique({ where: { id: vendorId }, select: { status: true } }),
    tx.whatsappMessageLogs.findFirst({
      where: {
        id: value.messageId,
        vendorId,
        contactId: value.contactId,
        wabPhoneNumberId: value.phoneNumberId,
        isIncomingMessage: false,
        status: { not: 'cancelled' },
      },
    }),
  ]);
  return Boolean(
    graph &&
    graph.updatedAt.toISOString() === value.graphFlowRevision &&
    (graph.data as any)?.phoneNumberId === value.phoneNumberId &&
    credential?.updatedAt.toISOString() === value.credentialRevision &&
    flow?.wabaId === (credential?.metadata as any)?.wabaId &&
    contact &&
    (!contact.platform || contact.platform === 'whatsapp') &&
    (!contact.wabPhoneNumberId || contact.wabPhoneNumberId === value.phoneNumberId) &&
    contact.waId === value.recipientWaId &&
    vendor?.status === 1 &&
    message &&
    (message.data as any)?.botFlowId === value.graphFlowId &&
    (message.data as any)?.nativeFlow?.id === value.flowId,
  );
}
