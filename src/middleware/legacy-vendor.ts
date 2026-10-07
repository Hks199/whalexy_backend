import type { RequestHandler } from 'express';
import { runMiddleware } from '../http/run-middleware.js';
import { authenticate, vendorScope } from './auth.js';
import { db } from '../database/client.js';
import { ApiError } from '../shared/api-error.js';

/** Resolve original business UUID URLs while retaining native authentication and membership. */
export const authenticateLegacyVendor: RequestHandler = async (req, res, next) => {
  if (!req.headers.authorization)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authorization required');
  const uid = String(req.params.vendorUid);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid))
    throw new ApiError(400, 'INVALID_VENDOR', 'Invalid business UUID');
  const vendor = await db.vendors.findUnique({ where: { uid }, select: { id: true } });
  if (!vendor) throw new ApiError(404, 'NOT_FOUND', 'Business not found');
  // Express restores params between layers; both checks must run inside this layer.
  req.params.vendorId = String(vendor.id);
  await runMiddleware(authenticate, req, res);
  await runMiddleware(vendorScope, req, res);
  next();
};
