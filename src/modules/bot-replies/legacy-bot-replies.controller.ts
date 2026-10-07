import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-bot-replies.service.js';
export const list: RequestHandler = async (req, res) =>
  sendResult(res, await services.list(serviceContext(req, res)));
export const edit: RequestHandler = async (req, res) =>
  sendResult(res, await services.edit(serviceContext(req, res)));
export const create: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'create'));
export const update: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'update'));
export const duplicate: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'duplicate'));
export const remove: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'delete'));
