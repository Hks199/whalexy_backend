import Joi from 'joi';
import { DateTime } from 'luxon';
import { idSchema } from '../../validation/common.js';
import {
  createResourceBodySchema,
  createServiceBodySchema,
  schedulePeriodSchema,
  appointmentTimezoneSchema,
} from './appointment-management.validation.js';

export const legacyCreateResourceBodySchema = createResourceBodySchema
  .rename('users__id', 'userId')
  .rename('auto_assign_chat', 'autoAssignChat');
export const legacyCreateServiceBodySchema = createServiceBodySchema
  .rename('duration_minutes', 'durationMinutes')
  .rename('buffer_before_minutes', 'bufferBeforeMinutes')
  .rename('buffer_after_minutes', 'bufferAfterMinutes')
  .rename('resource_uids', 'resourceUids');
export const legacyReplaceScheduleBodySchema = Joi.object({
  periods: Joi.array()
    .max(100)
    .items(
      schedulePeriodSchema
        .rename('start_local_time', 'startLocalTime')
        .rename('end_local_time', 'endLocalTime'),
    )
    .required(),
});

export const legacyAvailabilityQuerySchema = Joi.object({
  service_uid: Joi.string().uuid().required(),
  resource_uid: Joi.string().uuid().allow(null),
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  timezone: appointmentTimezoneSchema,
});
export const legacyHoldBodySchema = Joi.object({
  service_uid: Joi.string().uuid().required(),
  resource_uid: Joi.string().uuid().required(),
  starts_at: Joi.string()
    .max(100)
    .custom((value, helpers) =>
      DateTime.fromISO(value).isValid ? value : helpers.error('any.invalid'),
    )
    .required(),
  timezone: appointmentTimezoneSchema.required(),
  contact_id: idSchema.optional().allow(null),
});
export const legacyBookBodySchema = legacyHoldBodySchema.keys({
  idempotency_key: Joi.string().max(191).required(),
  hold_token: Joi.string().uuid().allow(null),
  source: Joi.string().valid('api', 'whatsapp', 'dashboard', 'google', 'calendly'),
  customer_name: Joi.string().max(190).allow(null),
  customer_phone: Joi.string().max(40).allow(null),
  customer_email: Joi.string().email().max(190).allow(null),
  notes: Joi.string().max(5000).allow(null),
});
