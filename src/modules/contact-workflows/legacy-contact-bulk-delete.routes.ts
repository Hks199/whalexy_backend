import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-bulk-delete.validation.js';
import * as controllers from './legacy-contact-bulk-delete.controller.js';
export const legacyContactBulkDeleteRouter = Router();
legacyContactBulkDeleteRouter.use(authenticateLegacyWorkspace);
legacyContactBulkDeleteRouter.post(
  '/delete-selected-process',
  permit('vendor.contacts.delete'),
  validate(schemas.legacySelectedContactDeleteBodySchema),
  controllers.selected,
);
legacyContactBulkDeleteRouter.post(
  ['/delete-all-process', '/delete-all-process/:groupUid'],
  permit('vendor.contacts.delete'),
  permit('vendor.chats.view_all'),
  validate(schemas.legacyFilteredContactDeleteParamsSchema, 'params'),
  validate(schemas.legacyFilteredContactDeleteBodySchema),
  controllers.filtered,
);
