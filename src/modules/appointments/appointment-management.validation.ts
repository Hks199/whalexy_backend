import Joi from 'joi';
import { DateTime } from 'luxon';
import { idSchema } from '../../validation/common.js';

export const appointmentTimezoneSchema = Joi.string()
  .max(100)
  .custom((value, helpers) =>
    DateTime.now().setZone(value).isValid ? value : helpers.error('any.invalid'),
  );
const status = Joi.string().valid('active', 'inactive');
const resource = Joi.object({
  name: Joi.string().trim().max(150).required(),
  type: Joi.string().valid('staff', 'room', 'equipment', 'facility', 'ai_agent').default('staff'),
  userId: idSchema.optional().allow(null),
  timezone: appointmentTimezoneSchema.required(),
  autoAssignChat: Joi.boolean().default(true),
  metadata: Joi.object().max(50).allow(null),
});
export const createResourceBodySchema = resource;
export const updateResourceBodySchema = resource.keys({ status: status.required() });
const service = Joi.object({
  name: Joi.string().trim().max(150).required(),
  description: Joi.string().max(5000).allow(null, ''),
  durationMinutes: Joi.number().integer().min(5).max(1440).required(),
  bufferBeforeMinutes: Joi.number().integer().min(0).max(240).default(0),
  bufferAfterMinutes: Joi.number().integer().min(0).max(240).default(0),
  price: Joi.number().min(0).max(99999999999999).precision(4).allow(null),
  currency: Joi.string()
    .uppercase()
    .pattern(/^[A-Z]{3}$/)
    .allow(null),
  timezone: appointmentTimezoneSchema.required(),
  resourceUids: Joi.array()
    .items(Joi.string().uuid().required())
    .unique()
    .min(1)
    .max(100)
    .required(),
});
export const createServiceBodySchema = service;
export const updateServiceBodySchema = service.keys({ status: status.required() });
const time = Joi.string()
  .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .required();
export const schedulePeriodSchema = Joi.object({
  weekday: Joi.number().integer().min(1).max(7).required(),
  startLocalTime: time,
  endLocalTime: time,
  timezone: appointmentTimezoneSchema.required(),
}).custom((period, helpers) =>
  period.endLocalTime > period.startLocalTime ? period : helpers.error('any.invalid'),
);
export const replaceScheduleBodySchema = Joi.object({
  periods: Joi.array().max(100).items(schedulePeriodSchema).required(),
});
export const createOffDutyBodySchema = Joi.object({
  resourceId: Joi.number().integer().min(0).max(2147483647).default(0),
  startsAt: Joi.date().iso().required(),
  endsAt: Joi.date().iso().greater(Joi.ref('startsAt')).required(),
  reason: Joi.string().trim().max(1000).allow(null, ''),
});
