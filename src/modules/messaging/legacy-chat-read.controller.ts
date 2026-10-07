import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-chat-read.service.js';
export const history: RequestHandler = async (req, res) => {
  sendResult(res, await services.history(serviceContext(req, res)));
};
export const inbox: RequestHandler = async (req, res) => {
  sendResult(res, await services.inbox(serviceContext(req, res)));
};
export const prepare: RequestHandler = async (req, res) => {
  sendResult(res, services.prepare(serviceContext(req, res)));
};

export const unread: RequestHandler = async (req, res) => {
  sendResult(res, await services.unread(serviceContext(req, res)));
};
