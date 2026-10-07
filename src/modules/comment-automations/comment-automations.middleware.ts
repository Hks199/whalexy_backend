import { ApiError } from '../../shared/api-error.js';
import type { RequestHandler } from 'express';

export const requireAutomationOwner: RequestHandler = (req, _res, next) => {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the owner can manage comment automation');
  next();
};
