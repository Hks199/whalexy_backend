import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-memberships.validation.js';
import * as controllers from './legacy-contact-memberships.controller.js';
export const legacyContactMembershipsRouter = Router();
legacyContactMembershipsRouter.use(authenticateLegacyWorkspace);
legacyContactMembershipsRouter.post(
  '/assign-groups-selected-process',
  permit('vendor.contacts.edit'),
  permit('vendor.groups.manage'),
  permit('vendor.chats.view_all'),
  validate(schemas.legacyGroupMembershipBodySchema),
  controllers.assignGroups,
);
legacyContactMembershipsRouter.post(
  '/:contactIdOrUid/:groupUid/remove-process',
  permit('vendor.contacts.edit'),
  permit('vendor.groups.manage'),
  validate(schemas.legacyGroupRemovalParamsSchema, 'params'),
  validate(schemas.legacyGroupRemovalBodySchema),
  controllers.removeGroup,
);
