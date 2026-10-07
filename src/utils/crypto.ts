import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { config } from '../config/environment.js';

export const opaqueToken = () => randomBytes(48).toString('base64url');
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function constantEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function verifyHmac(
  body: Buffer,
  provided: string,
  secret: string,
  encoding: 'hex' | 'base64' = 'hex',
) {
  if (!secret || !provided) return false;
  return constantEqual(createHmac('sha256', secret).update(body).digest(encoding), provided);
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.DATA_ENCRYPTION_KEY, 'hex'), iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    bytes.toString('base64url'),
  ].join('.');
}
export function decrypt(value: string): string {
  const [v, iv, tag, data] = value.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined)
    throw new Error('Invalid encrypted credential');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.DATA_ENCRYPTION_KEY, 'hex'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
