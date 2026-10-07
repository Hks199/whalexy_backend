import { verifyAccessToken } from '../security/tokens.js';
import type { RequestHandler } from 'express';
import { db } from '../database/client.js';
import { ApiError } from '../shared/api-error.js';
import { digest } from '../utils/crypto.js';

export { accessToken } from '../security/tokens.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const apiToken = req.headers.authorization?.match(/^ApiKey ([^\s]+)$/)?.[1];
  if (apiToken) {
    const vendorId = Number(req.params.vendorId);
    if (!Number.isInteger(vendorId) || vendorId < 1)
      throw new ApiError(401, 'UNAUTHENTICATED', 'API keys require business-scoped endpoints');
    const apiKey = await verifyApiKey(apiToken, vendorId),
      user = await db.users.findUnique({ where: { id: apiKey.userId }, select: { status: true } });
    if (user?.status !== 1) throw new ApiError(401, 'UNAUTHENTICATED', 'User is inactive');
    req.identity = {
      userId: apiKey.userId,
      sessionId: '',
      vendorId,
      permissions: [],
      apiKeyId: apiKey.id,
      apiPermissions: Array.isArray(apiKey.permissions)
        ? apiKey.permissions.filter((p): p is string => typeof p === 'string')
        : [],
    };
    next();
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer authentication required');
  try {
    const { payload } = await verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1 || typeof payload.sid !== 'string')
      throw new Error('Invalid claims');
    const [session, user] = await Promise.all([
      db.authSessions.findUnique({ where: { id: payload.sid } }),
      db.users.findUnique({ where: { id: userId }, select: { id: true, status: true } }),
    ]);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      user?.status !== 1
    )
      throw new Error('Inactive session');
    req.identity = { userId, sessionId: session.id, permissions: [] };
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name.startsWith('Prisma')) throw error;
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }
};
export const vendorScope: RequestHandler = async (req, _res, next) => {
  const vendorId = Number(req.params.vendorId);
  if (!Number.isInteger(vendorId) || vendorId < 1 || vendorId > 2147483647)
    throw new ApiError(400, 'INVALID_VENDOR', 'Invalid business identifier');
  const [vendor, membership] = await Promise.all([
    db.vendors.findUnique({ where: { id: vendorId }, select: { status: true } }),
    db.nativeMemberships.findUnique({
      where: { vendorId_userId: { vendorId, userId: req.identity!.userId } },
    }),
  ]);
  if (vendor?.status !== 1 || !membership?.active)
    throw new ApiError(403, 'FORBIDDEN', 'Business access denied');
  const membershipPermissions = Array.isArray(membership.permissions)
    ? membership.permissions.filter((p): p is string => typeof p === 'string')
    : [];
  const permissions = req.identity!.apiPermissions
    ? req.identity!.apiPermissions.filter(
        (p) => membershipPermissions.includes('*') || membershipPermissions.includes(p),
      )
    : membershipPermissions;
  req.identity = { ...req.identity!, vendorId, role: membership.role, permissions };
  next();
};
export const permit =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (
      !req.identity?.vendorId ||
      !permissions.every(
        (p) => req.identity!.permissions.includes(p) || req.identity!.permissions.includes('*'),
      )
    )
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    next();
  };
export { can } from '../shared/access-policy.js';
export async function verifyApiKey(token: string, vendorId: number) {
  const key = await db.apiKeys.findUnique({ where: { keyHash: digest(token) } });
  if (
    !key ||
    key.vendorId !== vendorId ||
    key.revokedAt ||
    (key.expiresAt && key.expiresAt <= new Date())
  )
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid API key');
  return key;
}
