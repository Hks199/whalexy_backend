import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { connectSocialAccountBodySchema } from './social-accounts.validation.js';
import * as controllers from './social-accounts.controller.js';

export const socialAccountsRouter = Router({ mergeParams: true });
socialAccountsRouter.post(
  '/social/connect',
  permit('vendor.integrations.manage'),
  validate(connectSocialAccountBodySchema),
  controllers.connectSocialAccount,
);
