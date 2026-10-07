import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  verifyMetaWebhook as verifyMetaWebhookService,
  handleMetaWebhook as handleMetaWebhookService,
  handleStoreWebhook as handleStoreWebhookService,
  handlePaymentWebhook as handlePaymentWebhookService,
} from './webhooks.service.js';

export const verifyMetaWebhook: RequestHandler = async (req, res) => {
  sendResult(res, await verifyMetaWebhookService(serviceContext(req, res)));
};
export const handleMetaWebhook: RequestHandler = async (req, res) => {
  sendResult(res, await handleMetaWebhookService(serviceContext(req, res)));
};
export const handleStoreWebhook: RequestHandler = async (req, res) => {
  sendResult(res, await handleStoreWebhookService(serviceContext(req, res)));
};
export const handlePaymentWebhook: RequestHandler = async (req, res) => {
  sendResult(res, await handlePaymentWebhookService(serviceContext(req, res)));
};
