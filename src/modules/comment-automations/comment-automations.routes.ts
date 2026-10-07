import * as middleware from './comment-automations.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listCommentAutomationsQuerySchema,
  listAutomationExecutionsQuerySchema,
  createCommentAutomationBodySchema,
  useIdParamsSchema,
  updateCommentAutomationBodySchema,
} from './comment-automations.validation.js';
import * as controllers from './comment-automations.controller.js';

export const commentAutomationsRouter = Router({ mergeParams: true });
commentAutomationsRouter.use(
  permit('vendor.bot.manage', 'vendor.integrations.manage'),
  middleware.requireAutomationOwner,
);
commentAutomationsRouter.get(
  '/',
  validate(listCommentAutomationsQuerySchema, 'query'),
  controllers.listCommentAutomations,
);
commentAutomationsRouter.get(
  '/executions',
  validate(listAutomationExecutionsQuerySchema, 'query'),
  controllers.listAutomationExecutions,
);
commentAutomationsRouter.post(
  '/',
  validate(createCommentAutomationBodySchema),
  controllers.createCommentAutomation,
);
commentAutomationsRouter.use('/:id', validate(useIdParamsSchema, 'params'));
commentAutomationsRouter.get('/:id', controllers.getCommentAutomation);
commentAutomationsRouter.put(
  '/:id',
  validate(updateCommentAutomationBodySchema),
  controllers.updateCommentAutomation,
);
commentAutomationsRouter.delete('/:id', controllers.deleteCommentAutomation);
