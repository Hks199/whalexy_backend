import { exportOrders as exportService } from './services/order-export.service.js';
import { updateStatus as statusService } from './services/order-status.service.js';
import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as service from './services/whatsapp-orders.service.js';
export const list: RequestHandler = async (req, res) =>
  sendResult(res, await service.list(serviceContext(req, res)));
export const detail: RequestHandler = async (req, res) =>
  sendResult(res, await service.detail(serviceContext(req, res)));
export const statistics: RequestHandler = async (req, res) =>
  sendResult(res, await service.statistics(serviceContext(req, res)));

export const exportOrders: RequestHandler = async (req, res) =>
  sendResult(res, await exportService(serviceContext(req, res)));
export const updateStatus: RequestHandler = async (req, res) =>
  sendResult(res, await statusService(serviceContext(req, res)));
