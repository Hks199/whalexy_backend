import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-chat-message.validation.js';
import * as controllers from './legacy-chat-message.controller.js';
export const legacyChatMessageRouter = Router();
legacyChatMessageRouter.use(authenticateLegacyWorkspace);
legacyChatMessageRouter.post(
  '/send',
  permit('vendor.chats.reply'),
  validate(schemas.textBody),
  controllers.text,
);
legacyChatMessageRouter.post(
  '/send-location',
  permit('vendor.chats.reply'),
  validate(schemas.locationBody),
  controllers.location,
);
legacyChatMessageRouter.post(
  '/message/:messageUid/reaction',
  permit('vendor.chats.reply'),
  validate(schemas.reactionParams, 'params'),
  validate(schemas.reactionBody),
  controllers.reaction,
);
