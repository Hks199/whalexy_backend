import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getReminderSettings as getReminderSettingsService,
  updateReminderSettings as updateReminderSettingsService,
} from './appointment-reminders.service.js';

export const getReminderSettings: RequestHandler = async (req, res) => {
  sendResult(res, await getReminderSettingsService(serviceContext(req, res)));
};
export const updateReminderSettings: RequestHandler = async (req, res) => {
  sendResult(res, await updateReminderSettingsService(serviceContext(req, res)));
};
