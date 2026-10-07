import * as middleware from './bot-flows.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listBotFlowsQuerySchema,
  createBotFlowBodySchema,
  updateBotFlowBodySchema,
  cloneBotFlowBodySchema,
  previewBotFlowBodySchema,
} from './bot-flows.validation.js';
import * as controllers from './bot-flows.controller.js';

export const botFlowsRouter = Router({ mergeParams: true });
botFlowsRouter.use(permit('vendor.bot.manage'));
botFlowsRouter.param('id', middleware.validateBotFlowId);
botFlowsRouter.get('/', validate(listBotFlowsQuerySchema, 'query'), controllers.listBotFlows);
for (const path of ['/', '/import'])
  botFlowsRouter.post(path, validate(createBotFlowBodySchema), controllers.createBotFlow);
botFlowsRouter.get('/:id', controllers.getBotFlow);
botFlowsRouter.put('/:id', validate(updateBotFlowBodySchema), controllers.updateBotFlow);
botFlowsRouter.get('/:id/export', controllers.exportBotFlow);
botFlowsRouter.post('/:id/clone', validate(cloneBotFlowBodySchema), controllers.cloneBotFlow);
botFlowsRouter.post('/:id/preview', validate(previewBotFlowBodySchema), controllers.previewBotFlow);
botFlowsRouter.delete('/:id', controllers.deleteBotFlow);
