import Joi from 'joi';
import type { RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';

export function validate(
  schema: Joi.Schema,
  location: 'body' | 'params' | 'query' = 'body',
): RequestHandler {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[location], {
      abortEarly: false,
      allowUnknown: false,
      convert: true,
      errors: { wrap: { label: false } },
    });
    if (error)
      return next(
        new ApiError(
          400,
          'VALIDATION_FAILED',
          'Request validation failed',
          error.details.map((d) => ({ field: d.path.join('.'), type: d.type })),
        ),
      );
    if (location === 'query') res.locals.query = value;
    else req[location] = value;
    next();
  };
}

export { idSchema, phoneSchema, pageSchema } from '../validation/common.js';
