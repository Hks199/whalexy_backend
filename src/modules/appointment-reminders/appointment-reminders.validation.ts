import Joi from 'joi';
import { DEFAULT_REMINDER } from './appointment-reminders.constants.js';

export const updateReminderSettingsBodySchema = Joi.object({
  enabled: Joi.boolean().required(),
  systemEnabled: Joi.boolean().default(true),
  triggerKeywords: Joi.array()
    .items(Joi.string().trim().min(1).max(100))
    .max(50)
    .default(['book appointment', 'appointment', 'schedule']),
  reminderOffsetsMinutes: Joi.array()
    .items(Joi.number().integer().min(1).max(525600))
    .unique()
    .max(20)
    .default([1440, 120]),
  reminderTemplateName: Joi.string()
    .pattern(/^[a-z0-9_]{1,512}$/)
    .allow(null)
    .default(null),
  reminderTemplateLanguage: Joi.string()
    .pattern(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/)
    .default('en_US'),
  confirmationMessage: Joi.string().max(2000).allow('', null),
  reminderMessage: Joi.string().max(2000).allow('').default(DEFAULT_REMINDER),
});
