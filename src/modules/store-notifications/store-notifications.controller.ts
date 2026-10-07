import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getStoreNotificationSettings as getStoreNotificationSettingsService,
  updateStoreNotificationSettings as updateStoreNotificationSettingsService,
} from './services/notification-settings.service.js';

export const getStoreNotificationSettings: RequestHandler = async (req, res) => {
  sendResult(res, await getStoreNotificationSettingsService(serviceContext(req, res)));
};
export const updateStoreNotificationSettings: RequestHandler = async (req, res) => {
  sendResult(res, await updateStoreNotificationSettingsService(serviceContext(req, res)));
};
