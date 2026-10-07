import { db } from '../../../database/client.js';
import { encrypt, decrypt } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { providerRequest, metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { config } from '../../../config/environment.js';
import { getFlowAccountContext } from '../../meta-flows/services/meta-flows-support.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { headerValue } from '../../../utils/headers.js';
import {
  requireFlowConfigurationOwner,
  generateFlowKeyPair,
  getFlowEndpointUrl,
  publicKeyFingerprint,
  presentFlowKeyState,
} from './flow-data-support.service.js';

export async function registerFlowEncryptionKey(requestInput: ServiceContext) {
  requireFlowConfigurationOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    { credential } = await getFlowAccountContext(vendorId, phone);
  const result = await metaOperation(
    requestInput,
    `flow-encryption:${phone}`,
    {},
    async (effect) => {
      const current = await db.integrationCredentials.findUniqueOrThrow({
          where: { id: credential.id },
        }),
        metadata = (current.metadata as any) ?? {};
      if (metadata.flowEncryption?.active || metadata.flowEncryption?.pending)
        throw new ApiError(
          409,
          'FLOW_KEY_EXISTS',
          'A retained Flow key already exists; reconcile its provider registration',
        );
      const registered = await metaRequest(
        vendorId,
        'whatsapp',
        phone,
        `${phone}/whatsapp_business_encryption`,
      );
      if (!Array.isArray(registered.data) || registered.data.length > 1)
        throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid encryption registration response');
      if (registered.data[0]?.business_public_key)
        throw new ApiError(
          409,
          'EXTERNAL_FLOW_KEY_EXISTS',
          'The provider already has an encryption key; migrate its private key before replacing it',
        );
      const pair = await generateFlowKeyPair('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      // Save before Graph: a lost response must never lose the accepted private key.
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:whatsapp:${phone}`},0))`;
        const fresh = await tx.integrationCredentials.findUniqueOrThrow({
            where: { id: credential.id },
          }),
          m = (fresh.metadata as any) ?? {};
        if (m.wabaId !== metadata.wabaId || m.flowEncryption?.active || m.flowEncryption?.pending)
          throw new ApiError(409, 'FLOW_KEY_CHANGED', 'Messaging configuration changed');
        await tx.integrationCredentials.update({
          where: { id: credential.id },
          data: {
            metadata: {
              ...m,
              flowEncryption: {
                pending: {
                  publicKey: pair.publicKey,
                  envelope: encrypt(pair.privateKey),
                  operationKey: `meta-operation:${headerValue(requestInput.headers, 'Idempotency-Key')}`,
                },
              },
            },
          },
        });
      });
      const form = new FormData();
      form.set('business_public_key', pair.publicKey);
      const response = await effect(() =>
        providerRequest(
          new URL(
            `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${phone}/whatsapp_business_encryption`,
          ),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${decrypt(current.secret)}` },
            body: form,
          },
        ),
      );
      if (response.success !== true)
        throw new ApiError(
          502,
          'PROVIDER_UNCERTAIN',
          'Public key registration needs reconciliation',
        );
      return {
        publicKey: pair.publicKey,
        endpointUri: getFlowEndpointUrl(credential.id),
        registered: true,
        pending: false,
      };
    },
    async (tx, value) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:whatsapp:${phone}`},0))`;
      const fresh = await tx.integrationCredentials.findUniqueOrThrow({
          where: { id: credential.id },
        }),
        m = (fresh.metadata as any) ?? {};
      if (m.flowEncryption?.pending?.publicKey !== value.publicKey)
        throw new ApiError(409, 'FLOW_KEY_CHANGED', 'Retained encryption key changed');
      await tx.integrationCredentials.update({
        where: { id: credential.id },
        data: { metadata: { ...m, flowEncryption: { active: m.flowEncryption.pending } } },
      });
    },
  );
  return serviceResult(result, { status: 201, format: 'json' });
}

export async function getFlowEncryptionKey(requestInput: ServiceContext) {
  requireFlowConfigurationOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    phone = String(requestInput.params.phoneNumberId),
    { credential } = await getFlowAccountContext(vendorId, phone);
  const remote = await metaRequest(
    vendorId,
    'whatsapp',
    phone,
    `${phone}/whatsapp_business_encryption`,
  );
  if (!Array.isArray(remote.data) || remote.data.length > 1)
    throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid encryption registration response');
  const registered = remote.data[0];
  let matched = false;
  if (registered?.business_public_key_signature_status === 'VALID') {
    const remoteFingerprint = publicKeyFingerprint(registered.business_public_key);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:whatsapp:${phone}`},0))`;
      const fresh = await tx.integrationCredentials.findUniqueOrThrow({
          where: { id: credential.id },
        }),
        m = (fresh.metadata as any) ?? {},
        pending = m.flowEncryption?.pending;
      matched = Boolean(
        m.flowEncryption?.active &&
        publicKeyFingerprint(m.flowEncryption.active.publicKey) === remoteFingerprint,
      );
      if (pending && publicKeyFingerprint(pending.publicKey) === remoteFingerprint) {
        const operation = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: pending.operationKey } },
        });
        const state = operation?.response as any;
        // A concurrent POST owns completion. Only reconcile an ended operation.
        if (
          state &&
          state.resource === `flow-encryption:${phone}` &&
          (['uncertain', 'rejected'].includes(state.state) ||
            (state.state === 'processing' && operation!.createdAt.getTime() < Date.now() - 300000))
        ) {
          const result = {
            publicKey: pending.publicKey,
            endpointUri: getFlowEndpointUrl(credential.id),
            registered: true,
            pending: false,
          };
          await tx.integrationCredentials.update({
            where: { id: credential.id },
            data: { metadata: { ...m, flowEncryption: { active: pending } } },
          });
          await tx.nativeIdempotency.update({
            where: { id: operation!.id },
            data: { response: { state: 'complete', resource: state.resource, result } },
          });
          await tx.auditEvents.create({
            data: {
              vendorId,
              actorId: requestInput.identity!.userId,
              action: 'reconcile',
              resource: 'flow-encryption',
              resourceId: credential.id,
            },
          });
          matched = true;
        }
      }
    });
  }
  const fresh = await db.integrationCredentials.findUniqueOrThrow({ where: { id: credential.id } });
  return serviceResult(
    {
      ...presentFlowKeyState(fresh),
      providerMatched: matched,
      signatureStatus: registered?.business_public_key_signature_status ?? null,
    },
    { status: 200, format: 'json' },
  );
}
