import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-bot-flows.validation.js';
import * as controllers from './legacy-bot-flows.controller.js';
export const legacyBotFlowsRouter = Router();
legacyBotFlowsRouter.use(authenticateLegacyWorkspace, permit('vendor.bot.manage'));
legacyBotFlowsRouter.get('/list-data', validate(schemas.tableQuery, 'query'), controllers.list);
legacyBotFlowsRouter.get(
  '/:botFlowIdOrUid/get-update-data',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  controllers.edit,
);
legacyBotFlowsRouter.get(
  '/:botFlowIdOrUid/export',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  controllers.exportFlow,
);
legacyBotFlowsRouter.post(
  '/:botFlowIdOrUid/clone-process',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.clone,
);
legacyBotFlowsRouter.post(
  '/:botFlowIdOrUid/delete-process',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.remove,
);
legacyBotFlowsRouter.post(
  '/update-process',
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.updateBody),
  controllers.update,
);
