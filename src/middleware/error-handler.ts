import { ApiError } from '../shared/api-error.js';
import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../observability/logger.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return _next(error);
  let status = error instanceof ApiError ? error.status : 500;
  let code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  let message = error instanceof ApiError ? error.message : 'The request could not be completed';
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      status = 409;
      code = 'CONFLICT';
      message = 'Record conflict';
    }
    if (error.code === 'P2003') {
      status = 409;
      code = 'RELATED_RECORD';
      message = 'Related record prevents this operation';
    }
    if (error.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Record not found';
    }
  }
  if (error?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  }
  if (error?.name === 'MulterError') {
    status = 400;
    code = 'INVALID_UPLOAD';
    message = 'Upload limits were exceeded';
  }
  if (error instanceof SyntaxError && 'body' in error) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON';
  }
  // Do not log database errors or provider messages: they can contain credentials/PII.
  if (status >= 500)
    logger.error({ requestId: req.id, code, errorName: error?.name }, 'request failed');
  res.status(status).json({
    error: {
      code,
      message,
      ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
    },
    requestId: req.id,
  });
};
