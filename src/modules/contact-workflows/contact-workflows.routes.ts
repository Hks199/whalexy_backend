import * as middleware from './contact-workflows.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  updateContactNotesBodySchema,
  updateContactLabelsBodySchema,
  updateContactCustomValuesBodySchema,
  assignContactBodySchema,
  mergeContactsBodySchema,
  archiveContactBodySchema,
  importContactsBodySchema,
  exportContactsQuerySchema,
} from './contact-workflows.validation.js';
import * as controllers from './contact-workflows.controller.js';

export const contactWorkflowsRouter = Router({ mergeParams: true });
export const groupsRouter = Router({ mergeParams: true });
contactWorkflowsRouter.param('id', middleware.validateContactId);
groupsRouter.param('id', middleware.validateGroupId);
groupsRouter.use(permit('vendor.groups.manage'), middleware.requireFullContactVisibility);
contactWorkflowsRouter.get(
  '/:id/notes',
  permit('vendor.contacts.view'),
  controllers.getContactNotes,
);
contactWorkflowsRouter.put(
  '/:id/notes',
  permit('vendor.contacts.edit'),
  validate(updateContactNotesBodySchema),
  controllers.updateContactNotes,
);
contactWorkflowsRouter.delete('/:id', permit('vendor.contacts.delete'), controllers.deleteContact);
contactWorkflowsRouter.get(
  '/:id/labels',
  permit('vendor.contacts.view'),
  controllers.getContactLabels,
);
contactWorkflowsRouter.put(
  '/:id/labels',
  permit('vendor.contacts.edit'),
  validate(updateContactLabelsBodySchema),
  controllers.updateContactLabels,
);
contactWorkflowsRouter.get(
  '/:id/custom-values',
  permit('vendor.contacts.view'),
  controllers.getContactCustomValues,
);
contactWorkflowsRouter.put(
  '/:id/custom-values',
  permit('vendor.contacts.edit'),
  validate(updateContactCustomValuesBodySchema),
  controllers.updateContactCustomValues,
);
contactWorkflowsRouter.delete(
  '/:id/groups/:groupId',
  permit('vendor.groups.manage'),
  controllers.removeContactFromGroup,
);
groupsRouter.post(
  '/:id/assign',
  permit('vendor.chats.assign'),
  validate(assignContactBodySchema),
  controllers.assignContact,
);
groupsRouter.post('/:id/merge', validate(mergeContactsBodySchema), controllers.mergeContacts);
groupsRouter.post('/:id/archive', validate(archiveContactBodySchema), controllers.archiveContact);
contactWorkflowsRouter.post(
  '/import',
  permit('vendor.contacts.create'),
  validate(importContactsBodySchema),
  controllers.importContacts,
);
contactWorkflowsRouter.get(
  '/export',
  permit('vendor.contacts.view'),
  validate(exportContactsQuerySchema, 'query'),
  controllers.exportContacts,
);
