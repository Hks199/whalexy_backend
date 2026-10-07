import { validScreenData, validateEndpoint } from './endpoint-definition.js';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { graphFlowProofAllowed } from '../../bot-flows/services/bot-meta-flow.js';
import {
  throwFlowSessionError,
  getFlowEndpointUrl,
  flowConfigReceiptKey,
  canonicalizeFlowData,
  isScalarFlowValue,
} from './flow-data-support.service.js';

export async function routeFlowData(credentialId: string, input: any) {
  if (input.action === 'ping') return { data: { status: 'active' } };
  if (input.data?.error) return { data: { acknowledged: true } };
  if (
    input.version !== '3.0' ||
    !['INIT', 'BACK', 'data_exchange'].includes(input.action) ||
    typeof input.flow_token !== 'string' ||
    input.flow_token.length < 40 ||
    input.flow_token.length > 128 ||
    (input.data !== undefined &&
      (input.data === null || typeof input.data !== 'object' || Array.isArray(input.data)))
  )
    throwFlowSessionError();
  return db.$transaction(async (tx) => {
    const credential = await tx.integrationCredentials.findUnique({ where: { id: credentialId } });
    if (!credential || credential.provider !== 'whatsapp') throwFlowSessionError();
    const vendorId = credential.vendorId,
      key = `flow-token:${digest(input.flow_token)}`;
    // Shares the proof row lock with signed nfm_reply consumption.
    await tx.$queryRaw`SELECT id FROM node_idempotency WHERE "vendorId" = ${vendorId} AND key = ${key} FOR UPDATE`;
    const proof = await tx.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId, key } },
      }),
      value = proof?.response as any;
    if (
      !value ||
      value.consumed ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() ||
      !Number.isInteger(value.contactId) ||
      value.contactId < 1 ||
      typeof value.flowId !== 'string' ||
      value.phoneNumberId !== credential.externalId
    )
      throwFlowSessionError();
    if (!(await graphFlowProofAllowed(tx, vendorId, value))) throwFlowSessionError();
    const [flow, contact, vendor] = await Promise.all([
      tx.nativeMetaFlows.findFirst({
        where: { id: value.flowId, vendorId, status: 'PUBLISHED', revision: value.revision ?? -1 },
      }),
      tx.contacts.findFirst({
        where: {
          id: value.contactId,
          vendorId,
          status: 1,
          platform: 'whatsapp',
          wabPhoneNumberId: credential.externalId,
        },
      }),
      tx.vendors.findUnique({ where: { id: vendorId } }),
    ]);
    if (
      !flow ||
      !contact ||
      !vendor ||
      vendor.status !== 1 ||
      flow.wabaId !== (credential.metadata as any)?.wabaId ||
      flow.endpointUri !== getFlowEndpointUrl(credential.id)
    )
      throwFlowSessionError();
    const saved = await tx.webhookReceipts.findUnique({
      where: { eventKey: flowConfigReceiptKey(vendorId, flow.id) },
    });
    if (!saved) throwFlowSessionError();
    const setup = validateEndpoint(flow.flowJson, saved.payload),
      state = value.endpointState ?? {
        current: setup.initialScreen,
        history: [],
        answers: {},
        steps: 0,
      };
    const requestHash = digest(JSON.stringify(canonicalizeFlowData(input)));
    if (state.lastHash === requestHash) return state.lastResponse;
    if (state.steps >= 100 || state.current === 'SUCCESS') throwFlowSessionError();
    let response: any;
    if (input.action === 'INIT')
      response = {
        screen: state.current,
        data: setup.screens.find((s: any) => s.id === state.current).data,
      };
    else {
      if (input.screen !== state.current) throwFlowSessionError();
      const screen = setup.screens.find((s: any) => s.id === state.current);
      if (!screen) throwFlowSessionError();
      if (input.action === 'BACK') {
        if (!state.history.length) throwFlowSessionError();
        state.current = state.history.pop();
        response = {
          screen: state.current,
          data: setup.screens.find((s: any) => s.id === state.current).data,
        };
      } else {
        for (const [output, field] of Object.entries(screen.bindings) as [string, string][]) {
          if (!Object.hasOwn(input.data ?? {}, field) || !isScalarFlowValue(input.data[field]))
            throw new ApiError(400, 'INVALID_FLOW_FIELD', 'Flow input field is missing or invalid');
          state.answers[output] = input.data[field];
        }
        if (screen.complete) {
          state.current = 'SUCCESS';
          response = {
            screen: 'SUCCESS',
            data: {
              extension_message_response: {
                params: { ...state.answers, flow_token: input.flow_token },
              },
            },
          };
        } else {
          state.history.push(state.current);
          state.current = screen.nextScreen;
          const next = setup.screens.find((s: any) => s.id === state.current);
          response = {
            screen: state.current,
            data: {
              ...next.data,
              ...Object.fromEntries(
                Object.entries(state.answers).filter(([k]) =>
                  Object.hasOwn(
                    (flow.flowJson as any).screens.find((s: any) => s.id === state.current).data,
                    k,
                  ),
                ),
              ),
            },
          };
        }
      }
    }
    state.steps++;
    state.lastHash = requestHash;
    state.lastResponse = response;
    if (
      response.screen !== 'SUCCESS' &&
      !validScreenData(flow.flowJson, response.screen, response.data)
    )
      throw new ApiError(400, 'INVALID_FLOW_FIELD', 'Flow values do not match screen field types');
    if (Buffer.byteLength(JSON.stringify(state)) > 100000)
      throw new ApiError(413, 'FLOW_STATE_LIMIT', 'Flow session data exceeded its limit');
    await tx.nativeIdempotency.update({
      where: { id: proof!.id },
      data: { response: { ...value, endpointState: state } },
    });
    return response;
  });
}
