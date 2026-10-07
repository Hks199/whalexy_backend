import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { querySchema } from './legacy-store-reports.validation.js';
import * as controllers from './legacy-store-reports.controller.js';
export const legacyStoreReportsRouter = Router();
legacyStoreReportsRouter.use(authenticateLegacyWorkspace);
legacyStoreReportsRouter.get(
  '/shopify/status',
  permit('vendor.integrations.manage'),
  validate(querySchema, 'query'),
  controllers.shopifyStatus,
);
legacyStoreReportsRouter.get(
  '/woocommerce/status',
  permit('vendor.integrations.manage'),
  validate(querySchema, 'query'),
  controllers.woocommerceStatus,
);
legacyStoreReportsRouter.get(
  '/shopify/statistics',
  permit('vendor.integrations.manage'),
  validate(querySchema, 'query'),
  controllers.shopifyStatistics,
);
legacyStoreReportsRouter.get(
  '/woocommerce/statistics',
  permit('vendor.integrations.manage'),
  validate(querySchema, 'query'),
  controllers.woocommerceStatistics,
);
