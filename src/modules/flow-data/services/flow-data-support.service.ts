import { generateKeyPair, createPublicKey } from 'node:crypto';
import { promisify } from 'node:util';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { config } from '../../../config/environment.js';
import { type ServiceContext } from '../../../shared/service-context.js';

export const generateFlowKeyPair = promisify(generateKeyPair);

export function requireFlowConfigurationOwner(req: ServiceContext) {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the business owner can configure Flow data exchange',
    );
}

export function getFlowEndpointUrl(id: string) {
  return `${config.PUBLIC_URL.replace(/\/$/, '')}/webhooks/flows/${id}`;
}

export function flowConfigReceiptKey(vendorId: number, flowId: string) {
  return `flow-data-config:${vendorId}:${flowId}`;
}

export function publicKeyFingerprint(pem: string) {
  try {
    return digest(createPublicKey(pem).export({ type: 'spki', format: 'der' }));
  } catch {
    throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid provider public key');
  }
}

export function presentFlowKeyState(credential: any) {
  const keys = credential.metadata?.flowEncryption;
  return {
    endpointUri: getFlowEndpointUrl(credential.id),
    registered: Boolean(keys?.active),
    pending: Boolean(keys?.pending),
    publicKey: keys?.active?.publicKey ?? null,
  };
}

export function throwFlowSessionError(): never {
  throw new ApiError(427, 'FLOW_SESSION_INVALID', 'This Flow session is no longer available');
}

export function isScalarFlowValue(value: any) {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= 1000)
  );
}

export function canonicalizeFlowData(value: any): any {
  return Array.isArray(value)
    ? value.map(canonicalizeFlowData)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonicalizeFlowData(value[k])]),
        )
      : value;
}
