import { ApiError } from '../../shared/api-error.js';
import { aiEntitlementActive } from './services/ai-entitlement.service.js';
import type { RequestHandler } from 'express';

export const requireAiAllowance: RequestHandler = async (req, _res, next) => {
  if (!(await aiEntitlementActive(req.identity!.vendorId!)))
    throw new ApiError(
      403,
      'AI_ENTITLEMENT_REQUIRED',
      'Active base subscription and AI Replies entitlement required',
    );
  next();
};
