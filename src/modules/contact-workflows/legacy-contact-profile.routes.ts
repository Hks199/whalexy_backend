import * as labelSchemas from './contact-labels.validation.js';
import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-profile.validation.js';
import * as controllers from './legacy-contact-profile.controller.js';
export const legacyContactProfileRouter = Router();
legacyContactProfileRouter.use(authenticateLegacyWorkspace);
legacyContactProfileRouter.post(
  '/chat/update-notes',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyNotesSchema),
  controllers.notes,
);
legacyContactProfileRouter.post(
  '/chat/assign-labels',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyLabelAssignmentSchema),
  controllers.assignLabels,
);
legacyContactProfileRouter.get(
  '/labels/:contactUid',
  permit('vendor.contacts.view'),
  validate(schemas.legacyLabelContactSchema, 'params'),
  validate(schemas.legacyLabelListSchema, 'query'),
  controllers.labels,
);

legacyContactProfileRouter.post(
  '/create-label',
  permit('vendor.groups.manage'),
  validate(labelSchemas.legacyLabelCreateSchema),
  controllers.createLabel,
);
legacyContactProfileRouter.post(
  '/chat/edit-label',
  permit('vendor.groups.manage'),
  validate(labelSchemas.legacyLabelUpdateSchema),
  controllers.editLabel,
);
legacyContactProfileRouter.post(
  '/chat/delete-label/:labelUid',
  permit('vendor.groups.manage'),
  validate(labelSchemas.legacyLabelDeleteParamsSchema, 'params'),
  validate(labelSchemas.legacyLabelDeleteBodySchema),
  controllers.removeLabel,
);

legacyContactProfileRouter.post(
  '/chat/assign-user',
  permit('vendor.chats.assign'),
  validate(schemas.legacyChatAssignmentSchema),
  controllers.assignChat,
);
