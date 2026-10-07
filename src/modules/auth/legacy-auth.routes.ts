import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { createAuthRateLimit } from '../../middleware/rate-limit.js';
import * as controllers from './legacy-auth.controller.js';
import * as schemas from './legacy-auth.validation.js';
export const legacyAuthRouter = Router();
legacyAuthRouter.post(
  '/user/login-process',
  createAuthRateLimit(),
  validate(schemas.legacyLoginBodySchema),
  controllers.loginLegacyUser,
);
legacyAuthRouter.get('/user/prepare-sign-up', controllers.prepareLegacyRegistration);
legacyAuthRouter.post(
  '/user/process-sign-up',
  createAuthRateLimit(),
  validate(schemas.legacyRegisterBodySchema),
  controllers.registerLegacyUser,
);
legacyAuthRouter.post('/user/logout', authenticate, controllers.logoutLegacyUser);
legacyAuthRouter.get('/user', authenticate, controllers.getLegacyCurrentUser);
// Laravel ANY registers these seven verbs, rather than every method Express knows.
legacyAuthRouter.get('/', controllers.getLegacyApiRoot);
legacyAuthRouter.post('/', controllers.getLegacyApiRoot);
legacyAuthRouter.put('/', controllers.getLegacyApiRoot);
legacyAuthRouter.patch('/', controllers.getLegacyApiRoot);
legacyAuthRouter.delete('/', controllers.getLegacyApiRoot);
legacyAuthRouter.options('/', controllers.getLegacyApiRoot);
legacyAuthRouter.head('/', controllers.getLegacyApiRoot);
