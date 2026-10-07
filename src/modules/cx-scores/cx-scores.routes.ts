import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listCustomerExperienceScoresQuerySchema,
  getCustomerExperienceScoreParamsSchema,
  retryCustomerExperienceScoreParamsSchema,
  retryCustomerExperienceScoreBodySchema,
} from './cx-scores.validation.js';
import * as controllers from './cx-scores.controller.js';

export const cxScoresRouter = Router({ mergeParams: true });
cxScoresRouter.get(
  '/',
  permit('vendor.cx.view'),
  validate(listCustomerExperienceScoresQuerySchema, 'query'),
  controllers.listCustomerExperienceScores,
);
cxScoresRouter.get(
  '/:id',
  permit('vendor.cx.view'),
  validate(getCustomerExperienceScoreParamsSchema, 'params'),
  controllers.getCustomerExperienceScore,
);
cxScoresRouter.post(
  '/:id/retry',
  permit('vendor.cx.manage'),
  validate(retryCustomerExperienceScoreParamsSchema, 'params'),
  validate(retryCustomerExperienceScoreBodySchema),
  controllers.retryCustomerExperienceScore,
);
