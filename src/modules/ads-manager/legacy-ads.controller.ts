import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-ads.service.js';
export const dashboard: RequestHandler = async (req, res) => {
  sendResult(res, await services.dashboard(serviceContext(req, res)));
};
export const campaigns: RequestHandler = async (req, res) => {
  sendResult(res, await services.campaigns(serviceContext(req, res)));
};
export const createCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await services.createCampaign(serviceContext(req, res)));
};
export const action: RequestHandler = async (req, res) => {
  sendResult(res, await services.action(serviceContext(req, res)));
};
export const conversion: RequestHandler = async (req, res) => {
  sendResult(res, await services.conversion(serviceContext(req, res)));
};
