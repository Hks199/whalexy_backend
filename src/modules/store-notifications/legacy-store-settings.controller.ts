import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { legacyStoreSettings } from './services/legacy-store-settings.service.js';
export const shopify: RequestHandler = async (req, res) =>
  sendResult(res, await legacyStoreSettings(serviceContext(req, res), 'shopify'));
export const woocommerce: RequestHandler = async (req, res) =>
  sendResult(res, await legacyStoreSettings(serviceContext(req, res), 'woocommerce'));
