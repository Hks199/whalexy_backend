import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { changeContactAutomation } from './services/contact-automation.service.js';
export const toggle: RequestHandler = async (req, res) => {
  sendResult(res, await changeContactAutomation(serviceContext(req, res), true));
};
