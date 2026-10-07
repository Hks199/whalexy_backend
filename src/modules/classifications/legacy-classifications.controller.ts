import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-classifications.service.js';
export const update: RequestHandler = async (req, res) => {
  sendResult(res, await services.update(serviceContext(req, res)));
};
export const createTag: RequestHandler = async (req, res) => {
  sendResult(res, await services.createTag(serviceContext(req, res)));
};
export const logs: RequestHandler = async (req, res) => {
  sendResult(res, await services.logs(serviceContext(req, res)));
};
