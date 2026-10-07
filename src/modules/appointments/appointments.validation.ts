import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { appointmentTimezoneSchema } from './appointment-management.validation.js';

export const input = Joi.object({
  serviceId: idSchema,
  resourceId: idSchema,
  contactId: idSchema.optional().allow(null),
  startsAt: Joi.date().iso().greater('now').required(),
});
export const getAppointmentAvailabilityQuerySchema = Joi.object({
  serviceId: idSchema,
  resourceId: idSchema,
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
});
export const createAppointmentResourceBodySchema = Joi.object({
  serviceId: idSchema,
  resourceId: idSchema,
});
export const holdAppointmentSlotBodySchema = input;
export const bookAppointmentBodySchema = input.keys({
  holdToken: Joi.string().uuid(),
  idempotencyKey: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{8,100}$/)
    .required(),
  notes: Joi.string().max(2000),
  timezone: appointmentTimezoneSchema,
  source: Joi.string().valid('api', 'whatsapp', 'dashboard', 'google', 'calendly'),
  customerName: Joi.string().max(190).allow(null),
  customerPhone: Joi.string().max(40).allow(null),
  customerEmail: Joi.string().email().max(190).allow(null),
});
export const rescheduleAppointmentBodySchema = Joi.object({
  startsAt: Joi.date().iso().greater('now').required(),
});
