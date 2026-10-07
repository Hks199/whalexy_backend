import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-translations.service.js';
export const languages: RequestHandler = async (req, res) =>
  sendResult(res, await services.read(serviceContext(req, res), false));
export const messages: RequestHandler = async (req, res) =>
  sendResult(res, await services.read(serviceContext(req, res), true));
export const create: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'create'));
export const update: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'update'));
export const remove: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'delete'));
export const updateMessage: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'message'));
