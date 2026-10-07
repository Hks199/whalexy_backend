import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import type { RequestHandler } from 'express';

export const requireSiteAdministrator: RequestHandler = async (req, _res, next) => {
  const user = await db.users.findUnique({
    where: { id: req.identity!.userId },
    select: { userRolesId: true },
  });
  if (req.identity!.apiKeyId || user?.userRolesId !== 1)
    throw new ApiError(403, 'FORBIDDEN', 'Super administrator access required');
  next();
};
export const requireExistingVendor: RequestHandler = async (req, _res, next) => {
  if (
    !(await db.vendors.findUnique({
      where: { id: Number(req.params.vendorId) },
      select: { id: true },
    }))
  )
    throw new ApiError(404, 'NOT_FOUND', 'Business not found');
  next();
};
