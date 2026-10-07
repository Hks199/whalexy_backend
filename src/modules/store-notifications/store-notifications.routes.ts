import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  getStoreNotificationSettingsParamsSchema,
  updateStoreNotificationSettingsParamsSchema,
  updateStoreNotificationSettingsBodySchema,
} from './store-notifications.validation.js';
import * as controllers from './store-notifications.controller.js';

export const storeNotificationsRouter = Router({ mergeParams: true });
storeNotificationsRouter.get(
  '/stores/:provider/:integrationId/notifications',
  permit('vendor.integrations.manage'),
  validate(getStoreNotificationSettingsParamsSchema, 'params'),
  controllers.getStoreNotificationSettings,
);
storeNotificationsRouter.put(
  '/stores/:provider/:integrationId/notifications',
  permit('vendor.integrations.manage'),
  validate(updateStoreNotificationSettingsParamsSchema, 'params'),
  validate(updateStoreNotificationSettingsBodySchema),
  controllers.updateStoreNotificationSettings,
);
