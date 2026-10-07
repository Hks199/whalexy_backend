import { Router } from 'express';
import { authenticateLegacyVendor } from '../../middleware/legacy-vendor.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-ads.validation.js';
import * as controllers from './legacy-ads.controller.js';
export const legacyAdsRouter = Router({ mergeParams: true });
legacyAdsRouter.use(authenticateLegacyVendor);
legacyAdsRouter.get(
  '/dashboard',
  permit('ads.analytics'),
  validate(schemas.legacyDashboardQuerySchema, 'query'),
  controllers.dashboard,
);
legacyAdsRouter.get(
  '/campaigns',
  permit('ads.view'),
  validate(schemas.legacyCampaignQuerySchema, 'query'),
  controllers.campaigns,
);
legacyAdsRouter.post(
  '/campaigns',
  permit('ads.create', 'ads.edit'),
  validate(schemas.legacyCampaignBodySchema),
  controllers.createCampaign,
);
legacyAdsRouter.post(
  '/campaigns/:campaign/action',
  permit('ads.edit'),
  validate(schemas.legacyCampaignActionSchema),
  controllers.action,
);
legacyAdsRouter.post(
  '/conversions',
  permit('ads.edit'),
  validate(schemas.legacyConversionSchema),
  controllers.conversion,
);
