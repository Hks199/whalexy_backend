import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-cx-scores.service.js';
export const show: RequestHandler = async (req, res) => {
  sendResult(res, await services.show(serviceContext(req, res)));
};
export const retry: RequestHandler = async (req, res) => {
  sendResult(res, await services.retry(serviceContext(req, res)));
};
