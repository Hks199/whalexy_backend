import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listSheetIntegrationsQuerySchema,
  createSheetIntegrationBodySchema,
  useUidParamsSchema,
  updateSheetStatusBodySchema,
  ingestSheetRowsBodySchema,
} from './sheets.validation.js';
import * as controllers from './sheets.controller.js';

export const sheetsRouter = Router({ mergeParams: true });
sheetsRouter.get(
  '/',
  permit('vendor.integrations.manage'),
  validate(listSheetIntegrationsQuerySchema, 'query'),
  controllers.listSheetIntegrations,
);
sheetsRouter.get(
  '/templates',
  permit('vendor.integrations.manage'),
  controllers.listSheetTemplates,
);
sheetsRouter.post(
  '/',
  permit('vendor.integrations.manage'),
  validate(createSheetIntegrationBodySchema),
  controllers.createSheetIntegration,
);
sheetsRouter.use('/:uid', validate(useUidParamsSchema, 'params'));
sheetsRouter.get('/:uid', permit('vendor.integrations.manage'), controllers.getSheetIntegration);
sheetsRouter.get('/:uid/script', permit('vendor.integrations.manage'), controllers.getSheetScript);
sheetsRouter.patch(
  '/:uid/status',
  permit('vendor.integrations.manage'),
  validate(updateSheetStatusBodySchema),
  controllers.updateSheetStatus,
);
sheetsRouter.delete(
  '/:uid',
  permit('vendor.integrations.manage'),
  controllers.deleteSheetIntegration,
);
sheetsRouter.post(
  '/:uid/rows',
  permit('vendor.integrations.manage', 'vendor.chats.reply'),
  validate(ingestSheetRowsBodySchema),
  controllers.ingestSheetRows,
);
