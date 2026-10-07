import * as middleware from './contact-fields.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listContactFieldsQuerySchema,
  createContactFieldBodySchema,
  updateContactFieldBodySchema,
  deleteContactFieldBodySchema,
} from './contact-fields.validation.js';
import * as controllers from './contact-fields.controller.js';

export const contactFieldsRouter = Router({ mergeParams: true });
contactFieldsRouter.param('id', middleware.validateContactFieldId);
contactFieldsRouter.get(
  '/',
  permit('vendor.contacts.view'),
  validate(listContactFieldsQuerySchema, 'query'),
  controllers.listContactFields,
);
contactFieldsRouter.get('/:id', permit('vendor.contacts.view'), controllers.getContactField);
contactFieldsRouter.post(
  '/',
  permit('vendor.contacts.edit'),
  validate(createContactFieldBodySchema),
  controllers.createContactField,
);
contactFieldsRouter.patch(
  '/:id',
  permit('vendor.contacts.edit'),
  validate(updateContactFieldBodySchema),
  controllers.updateContactField,
);
contactFieldsRouter.delete(
  '/:id',
  permit('vendor.contacts.edit'),
  validate(deleteContactFieldBodySchema),
  controllers.deleteContactField,
);
