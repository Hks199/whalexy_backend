import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-store-reports.service.js';
export const shopifyStatus: RequestHandler = async (req, res) => {
  sendResult(res, await services.status(serviceContext(req, res), 'shopify'));
};
export const woocommerceStatus: RequestHandler = async (req, res) => {
  sendResult(res, await services.status(serviceContext(req, res), 'woocommerce'));
};
export const shopifyStatistics: RequestHandler = async (req, res) => {
  sendResult(res, await services.statistics(serviceContext(req, res), 'shopify'));
};
export const woocommerceStatistics: RequestHandler = async (req, res) => {
  sendResult(res, await services.statistics(serviceContext(req, res), 'woocommerce'));
};
