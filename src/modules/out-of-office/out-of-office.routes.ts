import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  getAwaySettingsQuerySchema,
  updateAwaySettingsBodySchema,
} from './out-of-office.validation.js';
import * as controllers from './out-of-office.controller.js';

export const outOfOfficeRouter = Router({ mergeParams: true });
outOfOfficeRouter.get(
  '/',
  permit('vendor.out_of_office.view'),
  validate(getAwaySettingsQuerySchema, 'query'),
  controllers.getAwaySettings,
);
outOfOfficeRouter.post(
  '/',
  permit('vendor.out_of_office.manage'),
  validate(updateAwaySettingsBodySchema),
  controllers.updateAwaySettings,
);
