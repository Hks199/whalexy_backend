import { Router } from 'express';
import { authenticateLegacyVendor } from '../../middleware/legacy-vendor.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as controllers from './legacy-messaging.controller.js';
import * as schemas from './legacy-messaging.validation.js';

export const legacyMessagingRouter = Router({ mergeParams: true });
legacyMessagingRouter.use(authenticateLegacyVendor, permit('vendor.chats.reply'));
legacyMessagingRouter.post(
  '/send-message',
  validate(schemas.legacyTextMessageBodySchema),
  controllers.sendLegacyTextMessage,
);
legacyMessagingRouter.post(
  '/send-media-message',
  validate(schemas.legacyMediaMessageBodySchema),
  controllers.sendLegacyMediaMessage,
);
legacyMessagingRouter.post(
  '/send-template-message',
  validate(schemas.legacyTemplateMessageBodySchema),
  controllers.sendLegacyTemplateMessage,
);
