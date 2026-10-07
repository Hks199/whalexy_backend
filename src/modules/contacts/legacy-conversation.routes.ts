import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  legacyConversationParamsSchema,
  legacyConversationBodySchema,
} from './legacy-conversation.validation.js';
import * as controllers from './legacy-conversation.controller.js';
export const legacyConversationRouter = Router();
legacyConversationRouter.use(authenticateLegacyWorkspace);
legacyConversationRouter.post(
  '/:conversationId/resolve',
  permit('vendor.chats.reply'),
  validate(legacyConversationParamsSchema, 'params'),
  validate(legacyConversationBodySchema),
  controllers.resolve,
);
legacyConversationRouter.post(
  '/:conversationId/reopen',
  permit('vendor.chats.reply'),
  validate(legacyConversationParamsSchema, 'params'),
  validate(legacyConversationBodySchema),
  controllers.reopen,
);
legacyConversationRouter.post(
  '/:conversationId/handoff/accept',
  permit('vendor.chats.reply'),
  validate(legacyConversationParamsSchema, 'params'),
  validate(legacyConversationBodySchema),
  controllers.accept,
);
