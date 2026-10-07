import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  reviewManualSubscription as reviewManualSubscriptionService,
  overrideAiReplyAllowance as overrideAiReplyAllowanceService,
  removeAiReplyOverride as removeAiReplyOverrideService,
} from './services/billing-administration.service.js';
import { getBillingSummary as getBillingSummaryService } from './services/billing-summary.service.js';

export const reviewManualSubscription =
  (action: 'approve' | 'reject'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await reviewManualSubscriptionService(serviceContext(req, res), action));
  };
export const overrideAiReplyAllowance: RequestHandler = async (req, res) => {
  sendResult(res, await overrideAiReplyAllowanceService(serviceContext(req, res)));
};
export const removeAiReplyOverride: RequestHandler = async (req, res) => {
  sendResult(res, await removeAiReplyOverrideService(serviceContext(req, res)));
};
export const getBillingSummary: RequestHandler = async (req, res) => {
  sendResult(res, await getBillingSummaryService(serviceContext(req, res)));
};
