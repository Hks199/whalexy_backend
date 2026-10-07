import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-directory.validation.js';
import * as controllers from './legacy-contact-directory.controller.js';
export const legacyContactDirectoryRouter = Router();
legacyContactDirectoryRouter.use(authenticateLegacyWorkspace);
legacyContactDirectoryRouter.get(
  ['/list-data', '/list-data/:groupUid'],
  permit('vendor.contacts.view'),
  validate(schemas.legacyContactDirectoryParamsSchema, 'params'),
  validate(schemas.legacyContactDirectoryQuerySchema, 'query'),
  controllers.list,
);
