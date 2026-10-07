import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { getAwaySettingsQuerySchema } from './out-of-office.validation.js';
import { emptyQuery, legacyAwayBody } from './legacy-out-of-office.validation.js';
import * as controllers from './legacy-out-of-office.controller.js';
export const legacyOutOfOfficeRouter = Router();
legacyOutOfOfficeRouter.use(authenticateLegacyWorkspace);
legacyOutOfOfficeRouter.get(
  '/',
  permit('vendor.out_of_office.view'),
  validate(getAwaySettingsQuerySchema, 'query'),
  controllers.read,
);
legacyOutOfOfficeRouter.post(
  '/',
  permit('vendor.out_of_office.manage'),
  validate(emptyQuery, 'query'),
  validate(legacyAwayBody),
  controllers.write,
);
