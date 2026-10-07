import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import * as controllers from './legacy-appointment.controller.js';
import * as schemas from './legacy-appointment.validation.js';
import {
  authenticateAppointmentVendor,
  validateLegacyAppointmentBody,
} from './legacy-appointment.middleware.js';
import { validateAppointmentUid } from './appointments.middleware.js';

export const legacyAppointmentRouter = Router({ mergeParams: true });
// Legacy URL/field adapters use native sessions or scoped native API keys.
// Plaintext Laravel tokens and query-string credentials are not activated by this adapter.
legacyAppointmentRouter.use(authenticateAppointmentVendor);
legacyAppointmentRouter.param('resourceUid', validateAppointmentUid);
legacyAppointmentRouter.param('appointmentUid', validateAppointmentUid);
legacyAppointmentRouter.get(
  '/services',
  permit('vendor.appointments.view'),
  controllers.listLegacyAppointmentServices,
);
legacyAppointmentRouter.post(
  '/services',
  permit('vendor.appointments.manage'),
  validateLegacyAppointmentBody(schemas.legacyCreateServiceBodySchema),
  controllers.createLegacyAppointmentService,
);
legacyAppointmentRouter.get(
  '/resources',
  permit('vendor.appointments.view'),
  controllers.listLegacyAppointmentResources,
);
legacyAppointmentRouter.post(
  '/resources',
  permit('vendor.appointments.manage'),
  validateLegacyAppointmentBody(schemas.legacyCreateResourceBodySchema),
  controllers.createLegacyAppointmentResource,
);
legacyAppointmentRouter.put(
  '/resources/:resourceUid/schedule',
  permit('vendor.appointments.manage'),
  validateLegacyAppointmentBody(schemas.legacyReplaceScheduleBodySchema),
  controllers.replaceLegacyAppointmentSchedule,
);
legacyAppointmentRouter.get(
  '/availability',
  permit('vendor.appointments.view'),
  validateLegacyAppointmentBody(schemas.legacyAvailabilityQuerySchema, 'query'),
  controllers.getLegacyAppointmentAvailability,
);
legacyAppointmentRouter.post(
  '/holds',
  permit('vendor.appointments.manage'),
  validateLegacyAppointmentBody(schemas.legacyHoldBodySchema),
  controllers.holdLegacyAppointmentSlot,
);
legacyAppointmentRouter.post(
  '/',
  permit('vendor.appointments.manage'),
  validateLegacyAppointmentBody(schemas.legacyBookBodySchema),
  controllers.bookLegacyAppointment,
);
legacyAppointmentRouter.get(
  '/:appointmentUid',
  permit('vendor.appointments.view'),
  controllers.getLegacyAppointment,
);
legacyAppointmentRouter.post(
  '/:appointmentUid/cancel',
  permit('vendor.appointments.manage'),
  controllers.cancelLegacyAppointment,
);
