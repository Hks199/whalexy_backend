import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { sendMessageBodySchema } from './messaging.validation.js';
import * as controllers from './messaging.controller.js';

export const messagingRouter = Router({ mergeParams: true });
messagingRouter.post(
  '/send',
  permit('vendor.chats.reply'),
  validate(sendMessageBodySchema),
  controllers.sendMessage,
);
