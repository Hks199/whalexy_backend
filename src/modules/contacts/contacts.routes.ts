import * as middleware from './contacts.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listContactsQuerySchema,
  createContactBodySchema,
  getContactParamsSchema,
  updateContactParamsSchema,
  updateContactBodySchema,
  assignContactParamsSchema,
  assignContactBodySchema,
  resolveContactConversationBodySchema,
  updateContactAiSettingsBodySchema,
  updateContactMarketingConsentBodySchema,
  listContactMessagesQuerySchema,
  addContactToGroupsBodySchema,
} from './contacts.validation.js';
import * as controllers from './contacts.controller.js';

export const contactsRouter = Router({ mergeParams: true });
contactsRouter.param('id', middleware.validateContactId);
contactsRouter.get(
  '/',
  permit('vendor.contacts.view'),
  validate(listContactsQuerySchema, 'query'),
  controllers.listContacts,
);
contactsRouter.post(
  '/',
  permit('vendor.contacts.create'),
  validate(createContactBodySchema),
  controllers.createContact,
);
contactsRouter.get(
  '/:id',
  permit('vendor.contacts.view'),
  validate(getContactParamsSchema, 'params'),
  controllers.getContact,
);
contactsRouter.patch(
  '/:id',
  permit('vendor.contacts.edit'),
  validate(updateContactParamsSchema, 'params'),
  validate(updateContactBodySchema),
  controllers.updateContact,
);
contactsRouter.post(
  '/:id/assign',
  permit('vendor.chats.assign'),
  validate(assignContactParamsSchema, 'params'),
  validate(assignContactBodySchema),
  controllers.assignContact,
);
contactsRouter.post(
  '/:id/resolve',
  permit('vendor.chats.reply'),
  validate(resolveContactConversationBodySchema),
  controllers.resolveContactConversation,
);
contactsRouter.post(
  '/:id/ai',
  permit('vendor.ai.manage'),
  validate(updateContactAiSettingsBodySchema),
  controllers.updateContactAiSettings,
);
contactsRouter.post(
  '/:id/marketing-consent',
  permit('vendor.contacts.edit'),
  validate(updateContactMarketingConsentBodySchema),
  controllers.updateContactMarketingConsent,
);
contactsRouter.get(
  '/:id/messages',
  permit('vendor.contacts.view'),
  validate(listContactMessagesQuerySchema, 'query'),
  controllers.listContactMessages,
);
contactsRouter.post(
  '/:id/groups',
  permit('vendor.groups.manage'),
  validate(addContactToGroupsBodySchema),
  controllers.addContactToGroups,
);
