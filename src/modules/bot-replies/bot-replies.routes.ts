import * as middleware from './bot-replies.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listBotRepliesQuerySchema,
  createBotReplyBodySchema,
  updateBotReplyBodySchema,
  updateBotTimingBodySchema,
} from './bot-replies.validation.js';
import * as controllers from './bot-replies.controller.js';

export { withinBotTiming } from '../bot-flows/services/bot-timing.js';
export const botRepliesRouter = Router({ mergeParams: true });
botRepliesRouter.use(permit('vendor.bot.manage'));
botRepliesRouter.param('id', middleware.validateBotReplyId);
botRepliesRouter.get('/', validate(listBotRepliesQuerySchema, 'query'), controllers.listBotReplies);
botRepliesRouter.post('/', validate(createBotReplyBodySchema), controllers.createBotReply);
botRepliesRouter.put('/:id', validate(updateBotReplyBodySchema), controllers.updateBotReply);
botRepliesRouter.delete('/:id', controllers.deleteBotReply);
botRepliesRouter.put(
  '/settings/timing',
  validate(updateBotTimingBodySchema),
  controllers.updateBotTiming,
);
