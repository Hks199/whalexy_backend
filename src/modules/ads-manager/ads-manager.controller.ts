import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listAdAccounts as listAdAccountsService,
  connectAdAccount as connectAdAccountService,
  disconnectAdAccount as disconnectAdAccountService,
} from './services/ad-accounts.service.js';
import {
  syncAdStructure as syncAdStructureService,
  syncAdInsights as syncAdInsightsService,
} from './services/ad-synchronization.service.js';
import {
  listAdCampaigns as listAdCampaignsService,
  updateAdCampaignStatus as updateAdCampaignStatusService,
  getAdDashboard as getAdDashboardService,
  exportAdReport as exportAdReportService,
  recordAdConversion as recordAdConversionService,
  getContactAdAttributions as getContactAdAttributionsService,
} from './services/ad-reporting.service.js';

export const listAdAccounts: RequestHandler = async (req, res) => {
  sendResult(res, await listAdAccountsService(serviceContext(req, res)));
};
export const connectAdAccount: RequestHandler = async (req, res) => {
  sendResult(res, await connectAdAccountService(serviceContext(req, res)));
};
export const syncAdStructure: RequestHandler = async (req, res) => {
  sendResult(res, await syncAdStructureService(serviceContext(req, res)));
};
export const syncAdInsights: RequestHandler = async (req, res) => {
  sendResult(res, await syncAdInsightsService(serviceContext(req, res)));
};
export const disconnectAdAccount: RequestHandler = async (req, res) => {
  sendResult(res, await disconnectAdAccountService(serviceContext(req, res)));
};
export const listAdCampaigns: RequestHandler = async (req, res) => {
  sendResult(res, await listAdCampaignsService(serviceContext(req, res)));
};
export const updateAdCampaignStatus: RequestHandler = async (req, res) => {
  sendResult(res, await updateAdCampaignStatusService(serviceContext(req, res)));
};
export const getAdDashboard: RequestHandler = async (req, res) => {
  sendResult(res, await getAdDashboardService(serviceContext(req, res)));
};
export const exportAdReport: RequestHandler = async (req, res) => {
  sendResult(res, await exportAdReportService(serviceContext(req, res)));
};
export const recordAdConversion: RequestHandler = async (req, res) => {
  sendResult(res, await recordAdConversionService(serviceContext(req, res)));
};
export const getContactAdAttributions: RequestHandler = async (req, res) => {
  sendResult(res, await getContactAdAttributionsService(serviceContext(req, res)));
};
