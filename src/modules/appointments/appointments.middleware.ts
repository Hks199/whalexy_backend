import { ApiError } from '../../shared/api-error.js';
import type { RequestParamHandler } from 'express';

export const validateAppointmentUid: RequestParamHandler = (_req, _res, next, value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError(400, 'INVALID_ID', 'Invalid appointment UUID');
  next();
};

export const validateAppointmentId: RequestParamHandler = (_req, _res, next, value) => {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid appointment identifier');
  next();
};
