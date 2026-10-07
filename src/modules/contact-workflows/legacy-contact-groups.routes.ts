import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { requireFullContactVisibility } from './contact-workflows.middleware.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './contact-groups.validation.js';
import * as controllers from './legacy-contact-groups.controller.js';
export const legacyContactGroupsRouter = Router();
legacyContactGroupsRouter.use(
  authenticateLegacyWorkspace,
  permit('vendor.groups.manage'),
  requireFullContactVisibility,
);
legacyContactGroupsRouter.get(
  ['/list-data', '/:status/list-data'],
  validate(schemas.legacyGroupStatusSchema, 'params'),
  validate(schemas.legacyGroupListSchema, 'query'),
  controllers.list,
);
legacyContactGroupsRouter.post(
  '/add-process',
  validate(schemas.legacyGroupCreateSchema),
  controllers.create,
);
legacyContactGroupsRouter.post(
  '/update-process',
  validate(schemas.legacyGroupUpdateSchema),
  controllers.update,
);
legacyContactGroupsRouter.post(
  '/delete-selected-process',
  validate(schemas.legacyGroupBatchSchema),
  controllers.removeSelected,
);
legacyContactGroupsRouter.post(
  '/archive-selected-process',
  validate(schemas.legacyGroupBatchSchema),
  controllers.archiveSelected,
);
legacyContactGroupsRouter.post(
  '/unarchive-selected-process',
  validate(schemas.legacyGroupBatchSchema),
  controllers.unarchiveSelected,
);
legacyContactGroupsRouter.get(
  '/:contactGroupIdOrUid/get-update-data',
  validate(schemas.legacyGroupParamsSchema, 'params'),
  controllers.show,
);
legacyContactGroupsRouter.post(
  '/:contactGroupIdOrUid/delete-process',
  validate(schemas.legacyGroupParamsSchema, 'params'),
  validate(schemas.legacyGroupEmptySchema),
  controllers.remove,
);
legacyContactGroupsRouter.post(
  '/:contactGroupIdOrUid/archive-process',
  validate(schemas.legacyGroupParamsSchema, 'params'),
  validate(schemas.legacyGroupEmptySchema),
  controllers.archive,
);
legacyContactGroupsRouter.post(
  '/:contactGroupIdOrUid/unarchive-process',
  validate(schemas.legacyGroupParamsSchema, 'params'),
  validate(schemas.legacyGroupEmptySchema),
  controllers.unarchive,
);

legacyContactGroupsRouter.post(
  '/merge-process',
  validate(schemas.legacyGroupMergeSchema),
  controllers.merge,
);

legacyContactGroupsRouter.post(
  '/assign-agent-process',
  permit('vendor.chats.assign'),
  validate(schemas.legacyGroupAssignmentSchema),
  controllers.assignAgent,
);
