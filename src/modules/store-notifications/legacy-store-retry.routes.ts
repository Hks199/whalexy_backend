import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-store-retry.validation.js';
import * as controllers from './legacy-store-retry.controller.js';
export const legacyStoreRetryRouter = Router();
legacyStoreRetryRouter.use(authenticateLegacyWorkspace);
legacyStoreRetryRouter.post(
  '/shopify/notifications/:notificationId/resend',
  permit('vendor.integrations.manage'),
  permit('vendor.chats.reply'),
  validate(schemas.paramsSchema, 'params'),
  validate(schemas.bodySchema),
  controllers.shopify,
);
legacyStoreRetryRouter.post(
  '/woocommerce/notifications/:notificationId/resend',
  permit('vendor.integrations.manage'),
  permit('vendor.chats.reply'),
  validate(schemas.paramsSchema, 'params'),
  validate(schemas.bodySchema),
  controllers.woocommerce,
);
