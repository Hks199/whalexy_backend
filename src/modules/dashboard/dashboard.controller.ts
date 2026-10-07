import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { getDashboardSummary as getDashboardSummaryService } from './dashboard.service.js';

export const getDashboardSummary: RequestHandler = async (req, res) => {
  sendResult(res, await getDashboardSummaryService(serviceContext(req, res)));
};
