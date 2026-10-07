import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-campaign.service.js';
export const status: RequestHandler = async (req, res) =>
  sendResult(res, await services.status(serviceContext(req, res)));
export const list: RequestHandler = async (req, res) =>
  sendResult(res, await services.list(serviceContext(req, res)));
export const queue: RequestHandler = async (req, res) =>
  sendResult(res, await services.logs(serviceContext(req, res), 'queue'));
export const executed: RequestHandler = async (req, res) =>
  sendResult(res, await services.logs(serviceContext(req, res), 'executed'));
export const duplicate: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'duplicate'));
export const remove: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'delete'));
export const archive: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'archive'));
export const restore: RequestHandler = async (req, res) =>
  sendResult(res, await services.mutate(serviceContext(req, res), 'restore'));
