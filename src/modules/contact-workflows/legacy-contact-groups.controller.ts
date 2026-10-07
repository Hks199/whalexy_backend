import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-groups.service.js';
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
  sendResult(res, await services.change(serviceContext(req, res), 'delete'));
};
export const archive: RequestHandler = async (req, res) => {
  sendResult(res, await services.change(serviceContext(req, res), 'archive'));
};
export const unarchive: RequestHandler = async (req, res) => {
  sendResult(res, await services.change(serviceContext(req, res), 'unarchive'));
};
export const removeSelected: RequestHandler = async (req, res) => {
  sendResult(res, await services.change(serviceContext(req, res), 'delete', true));
};
export const archiveSelected: RequestHandler = async (req, res) => {
  sendResult(res, await services.change(serviceContext(req, res), 'archive', true));
};
export const unarchiveSelected: RequestHandler = async (req, res) => {
  sendResult(res, await services.change(serviceContext(req, res), 'unarchive', true));
};

export const merge: RequestHandler = async (req, res) => {
  sendResult(res, await services.merge(serviceContext(req, res)));
};

export const assignAgent: RequestHandler = async (req, res) => {
  sendResult(res, await services.assignAgent(serviceContext(req, res)));
};
