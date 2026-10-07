import { Router, raw } from 'express';
import * as controllers from './webhooks.controller.js';

export const webhookRouter = Router();
webhookRouter.get('/meta', controllers.verifyMetaWebhook);
webhookRouter.post(
  '/meta',
  raw({ type: 'application/json', limit: '1mb' }),
  controllers.handleMetaWebhook,
);
webhookRouter.post(
  '/stores/:provider/:credentialId',
  raw({ type: 'application/json', limit: '1mb' }),
  controllers.handleStoreWebhook,
);
webhookRouter.post(
  '/payments/:provider',
  raw({ type: 'application/json', limit: '1mb' }),
  controllers.handlePaymentWebhook,
);
