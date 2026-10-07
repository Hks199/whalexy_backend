import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/environment.js';

const key = new TextEncoder().encode(config.JWT_SECRET);
export async function accessToken(userId: number, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(userId))
    .setIssuer('whalexy')
    .setAudience('whalexy-api')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

export function verifyAccessToken(token: string) {
  return jwtVerify(token, key, {
    algorithms: ['HS256'],
    issuer: 'whalexy',
    audience: 'whalexy-api',
  });
}
