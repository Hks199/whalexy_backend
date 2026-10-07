import { db } from '../../../database/client.js';
import { decrypt, verifyHmac } from '../../../utils/crypto.js';
import {
  decryptFlowRequest,
  encryptFlowResponse,
} from '../../meta-flows/services/flow-encryption.js';
import { ApiError } from '../../../shared/api-error.js';
import { config } from '../../../config/environment.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { headerValue } from '../../../utils/headers.js';
import { routeFlowData } from './flow-sessions.service.js';

export async function handleEncryptedFlowRequest(requestInput: ServiceContext) {
  if (!config.META_APP_SECRET)
    throw new ApiError(
      503,
      'FLOW_ENDPOINT_NOT_CONFIGURED',
      'Meta signature verification is not configured',
    );
  const raw = requestInput.body,
    signature = headerValue(requestInput.headers, 'x-hub-signature-256') ?? '';
  if (
    !Buffer.isBuffer(raw) ||
    !/^sha256=[0-9a-f]{64}$/.test(signature) ||
    !verifyHmac(raw, signature.slice(7), config.META_APP_SECRET)
  )
    return serviceResult(undefined, { status: 432, format: 'end' });
  const credential = await db.integrationCredentials.findFirst({
      where: { id: String(requestInput.params.credentialId), provider: 'whatsapp' },
    }),
    keys = (credential?.metadata as any)?.flowEncryption;
  if (!credential || (!keys?.active && !keys?.pending))
    throw new ApiError(503, 'FLOW_KEY_REQUIRED', 'Flow encryption key is unavailable');
  let input;
  try {
    input = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid encrypted envelope');
  }
  const decrypted = decryptFlowRequest(
    input,
    [keys.active, keys.pending].filter(Boolean).map((k) => decrypt(k.envelope)),
  );
  try {
    const result = await routeFlowData(credential.id, decrypted.body);
    return serviceResult(encryptFlowResponse(result, decrypted.key, decrypted.iv), {
      status: 200,
      format: 'send',
      contentType: 'text/plain',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 427) {
      return serviceResult(
        encryptFlowResponse({ error_msg: error.message }, decrypted.key, decrypted.iv),
        { status: 427, format: 'send', contentType: 'text/plain' },
      );
      return;
    }
    throw error;
  }
}
