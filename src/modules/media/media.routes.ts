import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { mediaUpload } from './media.middleware.js';
import * as controllers from './media.controller.js';

export const mediaRouter = Router({ mergeParams: true });
mediaRouter.post(
  '/',
  permit('vendor.chats.reply'),
  mediaUpload.single('file'),
  controllers.uploadMedia,
);
mediaRouter.get('/:id', permit('vendor.contacts.view'), controllers.downloadMedia);
