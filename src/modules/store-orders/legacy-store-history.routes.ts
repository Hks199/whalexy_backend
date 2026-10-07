import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-store-history.validation.js';
import * as controllers from './legacy-store-history.controller.js';
export const legacyStoreHistoryRouter = Router();
legacyStoreHistoryRouter.use(authenticateLegacyWorkspace, permit('vendor.integrations.manage'));
legacyStoreHistoryRouter.get(
  '/shopify/orders',
  validate(schemas.shopifyOrdersQuery, 'query'),
  controllers.shopifyOrders,
);
legacyStoreHistoryRouter.get(
  '/woocommerce/orders',
  validate(schemas.wooOrdersQuery, 'query'),
  controllers.wooOrders,
);
legacyStoreHistoryRouter.get(
  '/shopify/orders/:orderId',
  validate(schemas.shopifyParams, 'params'),
  validate(schemas.detailQuery, 'query'),
  controllers.shopifyDetails,
);
legacyStoreHistoryRouter.get(
  '/woocommerce/orders/:orderId',
  validate(schemas.wooParams, 'params'),
  validate(schemas.detailQuery, 'query'),
  controllers.wooDetails,
);
legacyStoreHistoryRouter.get(
  '/shopify/notifications',
  validate(schemas.shopifyNotificationsQuery, 'query'),
  controllers.shopifyNotifications,
);
legacyStoreHistoryRouter.get(
  '/woocommerce/notifications',
  validate(schemas.wooNotificationsQuery, 'query'),
  controllers.wooNotifications,
);
