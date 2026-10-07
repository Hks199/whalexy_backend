import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as service from './services/legacy-search.service.js';
export const vendor: RequestHandler = async (req, res) =>
  sendResult(res, await service.vendorSearch(serviceContext(req, res)));
export const central: RequestHandler = async (req, res) =>
  sendResult(res, await service.centralSearch(serviceContext(req, res)));
