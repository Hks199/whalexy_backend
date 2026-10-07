import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-store-settings.validation.js';
import * as controllers from './legacy-store-settings.controller.js';
export const legacyStoreSettingsRouter = Router();
legacyStoreSettingsRouter.use(authenticateLegacyWorkspace, permit('vendor.integrations.manage'));
legacyStoreSettingsRouter.post(
  '/shopify/update-notification-settings',
  validate(schemas.querySchema, 'query'),
  validate(schemas.shopifyBody),
  controllers.shopify,
);
legacyStoreSettingsRouter.post(
  '/woocommerce/update-notification-settings',
  validate(schemas.querySchema, 'query'),
  validate(schemas.wooBody),
  controllers.woocommerce,
);
