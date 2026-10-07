import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { legacyContactListQuerySchema } from './legacy-contact-list.validation.js';
import { listLegacyContactsData } from './legacy-contact-list.controller.js';
export const legacyContactListRouter = Router({ mergeParams: true });
legacyContactListRouter.use(authenticateLegacyWorkspace, permit('vendor.contacts.view'));
legacyContactListRouter.get(
  '/contacts-data',
  validate(legacyContactListQuerySchema, 'query'),
  listLegacyContactsData,
);
legacyContactListRouter.get(
  '/contacts-data/:contactUid',
  validate(legacyContactListQuerySchema, 'query'),
  listLegacyContactsData,
);
