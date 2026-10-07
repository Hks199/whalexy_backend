import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getAwaySettings as getAwaySettingsService,
  updateAwaySettings as updateAwaySettingsService,
} from './out-of-office.service.js';

export const getAwaySettings: RequestHandler = async (req, res) => {
  sendResult(res, await getAwaySettingsService(serviceContext(req, res)));
};
export const updateAwaySettings: RequestHandler = async (req, res) => {
  sendResult(res, await updateAwaySettingsService(serviceContext(req, res)));
};
