import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { sendMessage as sendMessageService } from './messaging.service.js';

export const sendMessage: RequestHandler = async (req, res) => {
  sendResult(res, await sendMessageService(serviceContext(req, res)));
};
