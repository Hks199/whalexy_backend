import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-fields.validation.js';
import * as controllers from './legacy-contact-fields.controller.js';
export const legacyContactFieldsRouter = Router();
legacyContactFieldsRouter.use(authenticateLegacyWorkspace);
legacyContactFieldsRouter.get(
  '/list-data',
  permit('vendor.contacts.view'),
  validate(schemas.legacyFieldListSchema, 'query'),
  controllers.list,
);
legacyContactFieldsRouter.post(
  '/add-process',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyFieldCreateSchema),
  controllers.create,
);
legacyContactFieldsRouter.post(
  '/update-process',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyFieldUpdateSchema),
  controllers.update,
);
legacyContactFieldsRouter.get(
  '/:contactCustomFieldIdOrUid/get-update-data',
  permit('vendor.contacts.view'),
  validate(schemas.legacyFieldParamsSchema, 'params'),
  controllers.show,
);
legacyContactFieldsRouter.post(
  '/:contactCustomFieldIdOrUid/delete-process',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyFieldParamsSchema, 'params'),
  validate(schemas.legacyFieldDeleteSchema),
  controllers.remove,
);
