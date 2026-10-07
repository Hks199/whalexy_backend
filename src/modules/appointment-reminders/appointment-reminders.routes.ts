import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { updateReminderSettingsBodySchema } from './appointment-reminders.validation.js';
import * as controllers from './appointment-reminders.controller.js';

export const appointmentAutomationRouter = Router({ mergeParams: true });
appointmentAutomationRouter.get(
  '/',
  permit('vendor.appointments.view'),
  controllers.getReminderSettings,
);
appointmentAutomationRouter.put(
  '/',
  permit('vendor.appointments.manage'),
  validate(updateReminderSettingsBodySchema),
  controllers.updateReminderSettings,
);
