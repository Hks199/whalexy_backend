import { ApiError } from '../../shared/api-error.js';
import { can } from '../../shared/access-policy.js';
import type { RequestHandler, RequestParamHandler } from 'express';

export const validateCampaignId: RequestParamHandler = (_req, _res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid campaign identifier');
  next();
};
export const requireFullContactVisibility: RequestHandler = (req, _res, next) => {
  if (!can(req, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Campaigns require access to all customer chats');
  next();
};
