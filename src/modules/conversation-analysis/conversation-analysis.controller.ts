import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as service from './conversation-analysis.service.js';

export const requestConversationAnalysis: RequestHandler = async (req, res) => {
  sendResult(res, await service.requestConversationAnalysis(serviceContext(req, res)));
};
export const getConversationAnalysis: RequestHandler = async (req, res) => {
  sendResult(res, await service.getConversationAnalysis(serviceContext(req, res)));
};
