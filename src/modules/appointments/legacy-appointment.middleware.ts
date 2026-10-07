import type Joi from 'joi';
import type { RequestHandler } from 'express';
import { ApiError } from '../../shared/api-error.js';
export { authenticateLegacyVendor as authenticateAppointmentVendor } from '../../middleware/legacy-vendor.js';

export function validateLegacyAppointmentBody(
  schema: Joi.Schema,
  location: 'body' | 'query' = 'body',
): RequestHandler {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[location], {
      abortEarly: false,
      allowUnknown: false,
      convert: true,
    });
    if (error)
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        'Request validation failed',
        error.details.map((detail) => ({ field: detail.path.join('.'), type: detail.type })),
      );
    if (location === 'query') res.locals.query = value;
    else req.body = value;
    next();
  };
}
