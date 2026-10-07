import type { RequestHandler } from 'express';
import { db } from '../database/client.js';
import { ApiError } from '../shared/api-error.js';
import { runMiddleware } from '../http/run-middleware.js';
import { authenticate, vendorScope } from './auth.js';

export const authenticateLegacyWorkspace: RequestHandler = async (req, res, next) => {
  const selection = req.headers['x-vendor-id'];
  let vendorId: number | undefined;
  if (selection !== undefined) {
    if (
      typeof selection !== 'string' ||
      !/^[1-9]\d*$/.test(selection) ||
      Number(selection) > 2147483647
    )
      throw new ApiError(400, 'INVALID_VENDOR', 'X-Vendor-Id must identify one business');
    vendorId = Number(selection);
    req.params.vendorId = selection;
  }
  await runMiddleware(authenticate, req, res);
  if (!vendorId) {
    const memberships = await db.nativeMemberships.findMany({
      where: { userId: req.identity!.userId, active: true },
      select: { vendorId: true },
      take: 2,
    });
    if (memberships.length !== 1)
      throw new ApiError(
        409,
        'WORKSPACE_SELECTION_REQUIRED',
        'Select a business using X-Vendor-Id',
      );
    vendorId = memberships[0]!.vendorId;
  }
  req.params.vendorId = String(vendorId);
  await runMiddleware(vendorScope, req, res);
  next();
};
