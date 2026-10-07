import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as service from './services/legacy-tally.service.js';
export const pingLegacyTally: RequestHandler = async (req, res) => {
  sendResult(res, await service.pingLegacyTally(serviceContext(req, res)));
};
export const sendLegacyTallyInvoice: RequestHandler = async (req, res) => {
  sendResult(res, await service.sendLegacyTallyInvoice(serviceContext(req, res)));
};
