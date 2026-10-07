import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  connectMetaIntegrationBodySchema,
  connectStoreIntegrationBodySchema,
  syncMessageTemplatesBodySchema,
} from './integrations.validation.js';
import * as controllers from './integrations.controller.js';

export const integrationsRouter = Router({ mergeParams: true });
integrationsRouter.get('/', permit('vendor.integrations.manage'), controllers.listIntegrations);
integrationsRouter.post(
  '/meta',
  permit('vendor.whatsapp_setup.manage'),
  validate(connectMetaIntegrationBodySchema),
  controllers.connectMetaIntegration,
);
integrationsRouter.delete(
  '/:id',
  permit('vendor.integrations.manage'),
  controllers.disconnectIntegration,
);
integrationsRouter.post(
  '/store',
  permit('vendor.integrations.manage'),
  validate(connectStoreIntegrationBodySchema),
  controllers.connectStoreIntegration,
);
integrationsRouter.post(
  '/templates/sync',
  permit('vendor.templates.view'),
  validate(syncMessageTemplatesBodySchema),
  controllers.syncMessageTemplates,
);
