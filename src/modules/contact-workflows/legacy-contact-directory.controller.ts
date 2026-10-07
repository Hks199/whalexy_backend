import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-directory.service.js';
export const list: RequestHandler = async (req, res) => {
  sendResult(res, await services.list(serviceContext(req, res)));
};
