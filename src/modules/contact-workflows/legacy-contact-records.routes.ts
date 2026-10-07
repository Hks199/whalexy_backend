import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-records.validation.js';
import * as controllers from './legacy-contact-records.controller.js';
export const legacyContactRecordsRouter = Router();
legacyContactRecordsRouter.use(authenticateLegacyWorkspace);
legacyContactRecordsRouter.post(
  '/add-process',
  permit('vendor.contacts.create'),
  validate(schemas.legacyContactCreateBodySchema),
  controllers.create,
);
legacyContactRecordsRouter.post(
  '/update-process',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyContactUpdateBodySchema),
  controllers.update,
);
legacyContactRecordsRouter.get(
  '/:contactIdOrUid/get-update-data',
  permit('vendor.contacts.view'),
  validate(schemas.legacyContactRecordParamsSchema, 'params'),
  controllers.editData,
);
legacyContactRecordsRouter.post(
  '/:contactIdOrUid/delete-process',
  permit('vendor.contacts.delete'),
  validate(schemas.legacyContactRecordParamsSchema, 'params'),
  validate(schemas.legacyContactDeleteBodySchema),
  controllers.remove,
);
