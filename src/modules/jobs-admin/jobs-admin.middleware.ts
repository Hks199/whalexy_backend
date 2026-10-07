import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import type { RequestHandler } from 'express';

export const requireSiteAdministrator: RequestHandler = async (req, _res, next) => {
  if (
    req.identity!.apiKeyId ||
    (
      await db.users.findUnique({
        where: { id: req.identity!.userId },
        select: { userRolesId: true },
      })
    )?.userRolesId !== 1
  )
    throw new ApiError(403, 'FORBIDDEN', 'Super administrator access required');
  next();
};
export const requireJobOwner: RequestHandler = (req, _res, next) => {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can manage jobs');
  next();
};
