import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-memberships.service.js';
export const assignGroups: RequestHandler = async (req, res) => {
  sendResult(res, await services.assignGroups(serviceContext(req, res)));
};
export const removeGroup: RequestHandler = async (req, res) => {
  sendResult(res, await services.removeGroup(serviceContext(req, res)));
};
