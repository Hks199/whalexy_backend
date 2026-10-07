import { ApiError } from '../../shared/api-error.js';
import type { RequestParamHandler } from 'express';

export const validateContactId: RequestParamHandler = (req, _res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid contact identifier');
  next();
};
