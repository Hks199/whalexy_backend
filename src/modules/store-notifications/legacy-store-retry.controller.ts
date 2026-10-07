import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { retryStoreNotification } from './services/legacy-store-retry.service.js';
export const shopify: RequestHandler = async (req, res) => {
  sendResult(res, await retryStoreNotification(serviceContext(req, res), 'shopify'));
};
export const woocommerce: RequestHandler = async (req, res) => {
  sendResult(res, await retryStoreNotification(serviceContext(req, res), 'woocommerce'));
};
