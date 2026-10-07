import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  checkTallyConnection as checkTallyConnectionService,
  ingestTallyInvoice as ingestTallyInvoiceService,
  getTallyInvoiceStatus as getTallyInvoiceStatusService,
} from './tally.service.js';

export const checkTallyConnection: RequestHandler = async (req, res) => {
  sendResult(res, await checkTallyConnectionService(serviceContext(req, res)));
};
export const ingestTallyInvoice: RequestHandler = async (req, res) => {
  sendResult(res, await ingestTallyInvoiceService(serviceContext(req, res)));
};
export const getTallyInvoiceStatus: RequestHandler = async (req, res) => {
  sendResult(res, await getTallyInvoiceStatusService(serviceContext(req, res)));
};
