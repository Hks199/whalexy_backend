import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-cx-scores.validation.js';
import * as controllers from './legacy-cx-scores.controller.js';
export const legacyCxScoresRouter = Router();
legacyCxScoresRouter.use(authenticateLegacyWorkspace);
legacyCxScoresRouter.get(
  '/conversations/:conversationId',
  permit('vendor.cx.view'),
  validate(schemas.legacyCxConversationParamsSchema, 'params'),
  validate(schemas.legacyCxScoreQuerySchema, 'query'),
  controllers.show,
);
legacyCxScoresRouter.post(
  '/scores/:scoreId/retry',
  permit('vendor.cx.manage'),
  validate(schemas.legacyCxRetryParamsSchema, 'params'),
  validate(schemas.legacyCxRetryBodySchema),
  controllers.retry,
);
