import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as controllers from './appointment-management.controller.js';
import * as schemas from './appointment-management.validation.js';
import { validateAppointmentId, validateAppointmentUid } from './appointments.middleware.js';

export const appointmentManagementRouter = Router({ mergeParams: true });
appointmentManagementRouter.param('resourceUid', validateAppointmentUid);
appointmentManagementRouter.param('serviceUid', validateAppointmentUid);
appointmentManagementRouter.param('exceptionId', validateAppointmentId);
appointmentManagementRouter.get(
  '/resources',
  permit('vendor.appointments.view'),
  controllers.listResources,
);
appointmentManagementRouter.post(
  '/resources',
  permit('vendor.appointments.manage'),
  validate(schemas.createResourceBodySchema),
  controllers.createResource,
);
appointmentManagementRouter.put(
  '/resources/:resourceUid',
  permit('vendor.appointments.manage'),
  validate(schemas.updateResourceBodySchema),
  controllers.updateResource,
);
appointmentManagementRouter.delete(
  '/resources/:resourceUid',
  permit('vendor.appointments.manage'),
  controllers.deleteResource,
);
appointmentManagementRouter.get(
  '/resources/:resourceUid/schedule',
  permit('vendor.appointments.view'),
  controllers.getResourceSchedule,
);
appointmentManagementRouter.put(
  '/resources/:resourceUid/schedule',
  permit('vendor.appointments.manage'),
  validate(schemas.replaceScheduleBodySchema),
  controllers.replaceResourceSchedule,
);
appointmentManagementRouter.get(
  '/services',
  permit('vendor.appointments.view'),
  controllers.listServices,
);
appointmentManagementRouter.post(
  '/services',
  permit('vendor.appointments.manage'),
  validate(schemas.createServiceBodySchema),
  controllers.createService,
);
appointmentManagementRouter.put(
  '/services/:serviceUid',
  permit('vendor.appointments.manage'),
  validate(schemas.updateServiceBodySchema),
  controllers.updateService,
);
appointmentManagementRouter.delete(
  '/services/:serviceUid',
  permit('vendor.appointments.manage'),
  controllers.deleteAppointmentService,
);
appointmentManagementRouter.get(
  '/off-duty',
  permit('vendor.appointments.view'),
  controllers.listOffDuty,
);
appointmentManagementRouter.post(
  '/off-duty',
  permit('vendor.appointments.manage'),
  validate(schemas.createOffDutyBodySchema),
  controllers.createOffDuty,
);
appointmentManagementRouter.delete(
  '/off-duty/:exceptionId',
  permit('vendor.appointments.manage'),
  controllers.deleteOffDuty,
);
