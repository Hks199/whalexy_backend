import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  startMetaSignupBodySchema,
  completeMetaSignupBodySchema,
} from './meta-signup.validation.js';
import * as controllers from './meta-signup.controller.js';

export const metaSignupRouter = Router({ mergeParams: true });
metaSignupRouter.post(
  '/meta/signup/start',
  permit('vendor.whatsapp_setup.manage'),
  validate(startMetaSignupBodySchema),
  controllers.startMetaSignup,
);
metaSignupRouter.post(
  '/meta/signup/complete',
  permit('vendor.whatsapp_setup.manage'),
  validate(completeMetaSignupBodySchema),
  controllers.completeMetaSignup,
);
