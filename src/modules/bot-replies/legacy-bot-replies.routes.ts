import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-bot-replies.validation.js';
import * as controllers from './legacy-bot-replies.controller.js';
export const legacyBotRepliesRouter = Router();
legacyBotRepliesRouter.use(authenticateLegacyWorkspace, permit('vendor.bot.manage'));
legacyBotRepliesRouter.get('/list-data', validate(schemas.tableQuery, 'query'), controllers.list);
legacyBotRepliesRouter.get(
  '/:botReplyIdOrUid/get-update-data',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  controllers.edit,
);
legacyBotRepliesRouter.post(
  '/add-process',
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.createBody),
  controllers.create,
);
legacyBotRepliesRouter.post(
  '/update-process',
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.updateBody),
  controllers.update,
);
legacyBotRepliesRouter.post(
  '/:botReplyIdOrUid/duplicate-process',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.duplicate,
);
legacyBotRepliesRouter.post(
  '/:botReplyIdOrUid/delete-process',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.remove,
);
