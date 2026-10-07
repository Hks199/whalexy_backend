import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-classifications.validation.js';
import * as controllers from './legacy-classifications.controller.js';
export const legacyClassificationsRouter = Router();
legacyClassificationsRouter.use(authenticateLegacyWorkspace);
legacyClassificationsRouter.post(
  '/update',
  permit('vendor.cx.manage'),
  validate(schemas.legacyClassificationUpdateSchema),
  controllers.update,
);
legacyClassificationsRouter.post(
  '/tag/create',
  permit('vendor.cx.manage'),
  validate(schemas.legacyClassificationTagSchema),
  controllers.createTag,
);
legacyClassificationsRouter.get(
  '/logs/:contactUid',
  permit('vendor.cx.view'),
  validate(schemas.legacyClassificationContactSchema, 'params'),
  controllers.logs,
);
