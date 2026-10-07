import { constants, privateDecrypt, createDecipheriv, createCipheriv } from 'node:crypto';
import { ApiError } from '../../../shared/api-error.js';

function bytes(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'string' ||
    value.length > max * 2 ||
    !value.length ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('Invalid encoding');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < min || decoded.length > max || decoded.toString('base64') !== value)
    throw new Error('Invalid size');
  return decoded;
}
export function decryptFlowRequest(input: any, privateKeys: string[]) {
  try {
    const encryptedKey = bytes(input?.encrypted_aes_key, 256, 256),
      iv = bytes(input?.initial_vector, 16, 16),
      ciphertext = bytes(input?.encrypted_flow_data, 17, 65552);
    for (const privateKey of privateKeys) {
      try {
        const key = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
          encryptedKey,
        );
        if (key.length !== 16) continue;
        const cipher = createDecipheriv('aes-128-gcm', key, iv);
        cipher.setAuthTag(ciphertext.subarray(-16));
        const clear = Buffer.concat([cipher.update(ciphertext.subarray(0, -16)), cipher.final()]);
        const body = JSON.parse(clear.toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
        return { key, iv, body };
      } catch {
        /* Try the retained key after interrupted registration. */
      }
    }
  } catch {
    /* Return a safe protocol error without key material or customer data. */
  }
  throw new ApiError(421, 'FLOW_DECRYPTION_FAILED', 'Flow request could not be decrypted');
}
export function encryptFlowResponse(body: unknown, key: Buffer, requestIv: Buffer) {
  const responseIv = Buffer.from(requestIv.map((byte) => byte ^ 255)),
    cipher = createCipheriv('aes-128-gcm', key, responseIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
