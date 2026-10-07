import * as middleware from './appointments.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  getAppointmentAvailabilityQuerySchema,
  createAppointmentResourceBodySchema,
  holdAppointmentSlotBodySchema,
  bookAppointmentBodySchema,
  rescheduleAppointmentBodySchema,
} from './appointments.validation.js';
import * as controllers from './appointments.controller.js';

export const appointmentsRouter = Router({ mergeParams: true });
appointmentsRouter.param('id', middleware.validateAppointmentId);
// Availability is advisory; booking repeats all conflict checks under a resource lock.
appointmentsRouter.get(
  '/availability',
  permit('vendor.appointments.view'),
  validate(getAppointmentAvailabilityQuerySchema, 'query'),
  controllers.getAppointmentAvailability,
);
appointmentsRouter.post(
  '/service-resources',
  permit('vendor.appointments.manage'),
  validate(createAppointmentResourceBodySchema),
  controllers.createAppointmentResource,
);
appointmentsRouter.post(
  '/holds',
  permit('vendor.appointments.manage'),
  validate(holdAppointmentSlotBodySchema),
  controllers.holdAppointmentSlot,
);
appointmentsRouter.post(
  '/',
  permit('vendor.appointments.manage'),
  validate(bookAppointmentBodySchema),
  controllers.bookAppointment,
);
appointmentsRouter.get('/:id', permit('vendor.appointments.view'), controllers.getAppointment);
appointmentsRouter.post(
  '/:id/cancel',
  permit('vendor.appointments.manage'),
  controllers.cancelAppointment,
);
appointmentsRouter.post(
  '/:id/reschedule',
  permit('vendor.appointments.manage'),
  validate(rescheduleAppointmentBodySchema),
  controllers.rescheduleAppointment,
);
appointmentsRouter.post(
  '/:id/no-show',
  permit('vendor.appointments.manage'),
  controllers.markAppointmentNoShow,
);
