import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-bulk-delete.service.js';
export const selected: RequestHandler = async (req, res) => {
  sendResult(res, await services.selected(serviceContext(req, res)));
};
export const filtered: RequestHandler = async (req, res) => {
  sendResult(res, await services.filtered(serviceContext(req, res)));
};
