import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-chat-read.validation.js';
import * as controllers from './legacy-chat-read.controller.js';
export const legacyChatReadRouter = Router();
legacyChatReadRouter.use(authenticateLegacyWorkspace);
legacyChatReadRouter.get(
  ['/chat-data/:contactUid', '/chat-data/:contactUid/:way'],
  permit('vendor.contacts.view'),
  validate(schemas.historyParams, 'params'),
  validate(schemas.historyQuery, 'query'),
  controllers.history,
);
legacyChatReadRouter.get(
  ['/contacts-data', '/contacts-data/:contactUid'],
  permit('vendor.contacts.view'),
  validate(schemas.inboxParams, 'params'),
  validate(schemas.inboxQuery, 'query'),
  controllers.inbox,
);
legacyChatReadRouter.get(
  ['/chat/prepare-send-media', '/chat/prepare-send-media/:mediaType'],
  permit('vendor.chats.reply'),
  validate(schemas.prepareParams, 'params'),
  validate(schemas.prepareQuery, 'query'),
  controllers.prepare,
);

export const legacyUnreadRouter = Router();
legacyUnreadRouter.use(authenticateLegacyWorkspace);
legacyUnreadRouter.get(
  '/chat/unread-count',
  permit('vendor.contacts.view'),
  validate(schemas.unreadQuery, 'query'),
  controllers.unread,
);
