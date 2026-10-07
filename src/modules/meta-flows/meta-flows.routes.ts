import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  phoneScopeParamsSchema,
  listMetaFlowsQuerySchema,
  createMetaFlowBodySchema,
  updateMetaFlowBodySchema,
  updateMetaFlowDefinitionBodySchema,
  changeMetaFlowStateBodySchema,
} from './meta-flows.validation.js';
import * as controllers from './meta-flows.controller.js';

export const metaFlowsRouter = Router({ mergeParams: true });
metaFlowsRouter.use(validate(phoneScopeParamsSchema, 'params'));
metaFlowsRouter.get(
  '/',
  permit('vendor.bot.manage'),
  validate(listMetaFlowsQuerySchema, 'query'),
  controllers.listMetaFlows,
);
metaFlowsRouter.post(
  '/',
  permit('vendor.bot.manage'),
  validate(createMetaFlowBodySchema),
  controllers.createMetaFlow,
);
metaFlowsRouter.get('/:flowId', permit('vendor.bot.manage'), controllers.getMetaFlow);
metaFlowsRouter.put(
  '/:flowId',
  permit('vendor.bot.manage'),
  validate(updateMetaFlowBodySchema),
  controllers.updateMetaFlow,
);
metaFlowsRouter.put(
  '/:flowId/json',
  permit('vendor.bot.manage'),
  validate(updateMetaFlowDefinitionBodySchema),
  controllers.updateMetaFlowDefinition,
);
for (const action of ['publish', 'deprecate', 'delete'] as const)
  metaFlowsRouter.post(
    `/:flowId/${action}`,
    permit('vendor.bot.manage'),
    validate(changeMetaFlowStateBodySchema),
    controllers.changeMetaFlowState(action),
  );
metaFlowsRouter.get('/:flowId/preview', permit('vendor.bot.manage'), controllers.previewMetaFlow);
metaFlowsRouter.get(
  '/:flowId/json',
  permit('vendor.bot.manage'),
  controllers.getMetaFlowDefinition,
);
