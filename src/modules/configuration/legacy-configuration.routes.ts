import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireSiteAdministrator } from './configuration.middleware.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-configuration.validation.js';
import * as controllers from './legacy-configuration.controller.js';
export const legacyConfigurationRouter = Router();
legacyConfigurationRouter.use(
  authenticate,
  requireSiteAdministrator,
  validate(schemas.emptyQuery, 'query'),
);
legacyConfigurationRouter.get('/:pageType', validate(schemas.params, 'params'), controllers.read);
legacyConfigurationRouter.post(
  '/:pageType/process-configuration-store',
  validate(schemas.params, 'params'),
  validate(schemas.body),
  controllers.write,
);
