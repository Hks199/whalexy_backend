import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-fields.service.js';
export const list: RequestHandler = async (req, res) => {
  sendResult(res, await services.list(serviceContext(req, res)));
};
export const show: RequestHandler = async (req, res) => {
  sendResult(res, await services.show(serviceContext(req, res)));
};
export const create: RequestHandler = async (req, res) => {
  sendResult(res, await services.create(serviceContext(req, res)));
};
export const update: RequestHandler = async (req, res) => {
  sendResult(res, await services.update(serviceContext(req, res)));
};
export const remove: RequestHandler = async (req, res) => {
  sendResult(res, await services.remove(serviceContext(req, res)));
};
