import type { RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';

export const notFound: RequestHandler = (_req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found'));
