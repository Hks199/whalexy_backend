import { Router } from 'express';
import { authenticateLegacyVendor } from '../../middleware/legacy-vendor.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact.validation.js';
import * as controllers from './legacy-contact.controller.js';

export const legacyContactRouter = Router({ mergeParams: true });
legacyContactRouter.use(authenticateLegacyVendor);
legacyContactRouter.post(
  '/create',
  permit('vendor.contacts.create'),
  validate(schemas.legacyCreateContactBodySchema),
  controllers.createLegacyContact,
);
legacyContactRouter.post(
  '/update/:phoneNumber',
  permit('vendor.contacts.edit'),
  validate(schemas.legacyUpdateContactBodySchema),
  controllers.updateLegacyContact,
);
