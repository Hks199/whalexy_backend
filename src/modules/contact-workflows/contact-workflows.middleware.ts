import { ApiError } from '../../shared/api-error.js';
import { can } from '../../shared/access-policy.js';
import { parseContactIdentifier } from './services/contact-workflows-support.service.js';
import type { RequestHandler, RequestParamHandler } from 'express';

export const validateContactId: RequestParamHandler = (_req, _res, next, value) => {
  parseContactIdentifier(value);
  next();
};
export const validateGroupId: RequestParamHandler = (_req, _res, next, value) => {
  parseContactIdentifier(value);
  next();
};
export const requireFullContactVisibility: RequestHandler = (req, _res, next) => {
  if (!can(req, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Group administration requires access to all contacts');
  next();
};
