import express, { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  phoneScopeParamsSchema,
  registerFlowEncryptionKeyBodySchema,
  configureFlowDataEndpointBodySchema,
} from './flow-data.validation.js';
import * as controllers from './flow-data.controller.js';

export const flowDataSettingsRouter = Router({ mergeParams: true });
export const flowDataWebhookRouter = Router();
flowDataSettingsRouter.use(validate(phoneScopeParamsSchema, 'params'));
flowDataSettingsRouter.post(
  '/encryption-key',
  permit('vendor.whatsapp_setup.manage'),
  validate(registerFlowEncryptionKeyBodySchema),
  controllers.registerFlowEncryptionKey,
);
flowDataSettingsRouter.get(
  '/encryption-key',
  permit('vendor.whatsapp_setup.manage'),
  controllers.getFlowEncryptionKey,
);
flowDataSettingsRouter.put(
  '/:flowId/data-endpoint',
  permit('vendor.bot.manage'),
  validate(configureFlowDataEndpointBodySchema),
  controllers.configureFlowDataEndpoint,
);
flowDataSettingsRouter.get(
  '/:flowId/data-endpoint',
  permit('vendor.bot.manage'),
  controllers.getFlowDataEndpoint,
);
flowDataWebhookRouter.post(
  '/:credentialId',
  express.raw({ type: 'application/json', limit: '128kb' }),
  controllers.handleEncryptedFlowRequest,
);
