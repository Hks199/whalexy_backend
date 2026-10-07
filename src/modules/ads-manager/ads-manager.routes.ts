import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  connectAdAccountBodySchema,
  syncAdStructureBodySchema,
  syncAdInsightsBodySchema,
  listAdCampaignsQuerySchema,
  updateAdCampaignStatusBodySchema,
  getAdDashboardQuerySchema,
  exportAdReportQuerySchema,
  recordAdConversionBodySchema,
  getContactAdAttributionsQuerySchema,
} from './ads-manager.validation.js';
import { validateAdAccountParams } from './ads-manager.middleware.js';
import * as controllers from './ads-manager.controller.js';

export const adsManagerRouter = Router({ mergeParams: true });
adsManagerRouter.get('/accounts', permit('ads.view'), controllers.listAdAccounts);
adsManagerRouter.post(
  '/accounts/connect',
  permit('ads.edit'),
  validate(connectAdAccountBodySchema),
  controllers.connectAdAccount,
);
adsManagerRouter.post(
  '/accounts/:id/structure/sync',
  permit('ads.edit'),
  validateAdAccountParams,
  validate(syncAdStructureBodySchema),
  controllers.syncAdStructure,
);
adsManagerRouter.post(
  '/accounts/:id/sync',
  permit('ads.edit'),
  validateAdAccountParams,
  validate(syncAdInsightsBodySchema),
  controllers.syncAdInsights,
);
adsManagerRouter.delete(
  '/accounts/:id',
  permit('ads.edit'),
  validateAdAccountParams,
  controllers.disconnectAdAccount,
);
adsManagerRouter.get(
  '/campaigns',
  permit('ads.view'),
  validate(listAdCampaignsQuerySchema, 'query'),
  controllers.listAdCampaigns,
);
adsManagerRouter.post(
  '/campaigns/:id/status',
  permit('ads.edit'),
  validateAdAccountParams,
  validate(updateAdCampaignStatusBodySchema),
  controllers.updateAdCampaignStatus,
);
adsManagerRouter.get(
  '/dashboard',
  permit('ads.analytics'),
  validate(getAdDashboardQuerySchema, 'query'),
  controllers.getAdDashboard,
);
adsManagerRouter.get(
  '/reports/export.csv',
  permit('ads.reports'),
  validate(exportAdReportQuerySchema, 'query'),
  controllers.exportAdReport,
);
adsManagerRouter.post(
  '/conversions',
  permit('ads.edit'),
  validate(recordAdConversionBodySchema),
  controllers.recordAdConversion,
);
adsManagerRouter.get(
  '/contacts/:id/attributions',
  permit('ads.analytics', 'vendor.contacts.view'),
  validateAdAccountParams,
  validate(getContactAdAttributionsQuerySchema, 'query'),
  controllers.getContactAdAttributions,
);
