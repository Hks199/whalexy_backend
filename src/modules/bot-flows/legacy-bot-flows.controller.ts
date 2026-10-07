import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-bot-flows.service.js';
export const list: RequestHandler = async (req, res) =>
  sendResult(res, await services.list(serviceContext(req, res)));
export const edit: RequestHandler = async (req, res) =>
  sendResult(res, await services.read(serviceContext(req, res), false));
export const exportFlow: RequestHandler = async (req, res) =>
  sendResult(res, await services.read(serviceContext(req, res), true));
export const clone: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'clone'));
export const remove: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'delete'));
export const update: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'update'));
