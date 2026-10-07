import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as history from './services/legacy-store-history.service.js';
export const shopifyOrders: RequestHandler = async (req, res) =>
  sendResult(res, await history.listOrders(serviceContext(req, res), 'shopify'));
export const wooOrders: RequestHandler = async (req, res) =>
  sendResult(res, await history.listOrders(serviceContext(req, res), 'woocommerce'));
export const shopifyDetails: RequestHandler = async (req, res) =>
  sendResult(res, await history.orderDetails(serviceContext(req, res), 'shopify'));
export const wooDetails: RequestHandler = async (req, res) =>
  sendResult(res, await history.orderDetails(serviceContext(req, res), 'woocommerce'));
export const shopifyNotifications: RequestHandler = async (req, res) =>
  sendResult(res, await history.listNotifications(serviceContext(req, res), 'shopify'));
export const wooNotifications: RequestHandler = async (req, res) =>
  sendResult(res, await history.listNotifications(serviceContext(req, res), 'woocommerce'));
