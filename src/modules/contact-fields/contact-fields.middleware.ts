import { ApiError } from '../../shared/api-error.js';
import type { RequestParamHandler } from 'express';

export const validateContactFieldId: RequestParamHandler = (_req, _res, next, id) => {
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid field identifier');
  next();
};
