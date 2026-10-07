import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-configuration.service.js';
export const read: RequestHandler = async (req, res) =>
  sendResult(res, await services.read(serviceContext(req, res)));
export const write: RequestHandler = async (req, res) =>
  sendResult(res, await services.write(serviceContext(req, res)));
