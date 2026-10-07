import * as middleware from './handoffs.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listHandoffsQuerySchema,
  transferHandoffBodySchema,
  resolveHandoffBodySchema,
  acceptContactHandoffParamsSchema,
  acceptContactHandoffBodySchema,
} from './handoffs.validation.js';
import * as controllers from './handoffs.controller.js';

export const handoffsRouter = Router({ mergeParams: true });
handoffsRouter.post(
  '/contacts/:contactId/accept',
  permit('vendor.chats.reply'),
  validate(acceptContactHandoffParamsSchema, 'params'),
  validate(acceptContactHandoffBodySchema),
  controllers.acceptContactHandoff,
);
handoffsRouter.param('id', middleware.validateHandoffId);
handoffsRouter.get(
  '/',
  permit('vendor.contacts.view'),
  validate(listHandoffsQuerySchema, 'query'),
  controllers.listHandoffs,
);
handoffsRouter.post(
  '/:id/transfer',
  permit('vendor.chats.assign'),
  validate(transferHandoffBodySchema),
  controllers.transferHandoff,
);
handoffsRouter.post(
  '/:id/resolve',
  permit('vendor.ai.manage'),
  validate(resolveHandoffBodySchema),
  controllers.resolveHandoff,
);
