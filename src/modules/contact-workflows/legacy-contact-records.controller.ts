import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-records.service.js';
import * as writes from './services/legacy-contact-write.service.js';
export const create: RequestHandler = async (req, res) => {
  sendResult(res, await writes.create(serviceContext(req, res)));
};
export const update: RequestHandler = async (req, res) => {
  sendResult(res, await writes.update(serviceContext(req, res)));
};
export const editData: RequestHandler = async (req, res) => {
  sendResult(res, await services.editData(serviceContext(req, res)));
};
export const remove: RequestHandler = async (req, res) => {
  sendResult(res, await services.remove(serviceContext(req, res)));
};
