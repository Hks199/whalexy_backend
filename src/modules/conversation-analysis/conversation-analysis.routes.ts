import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { requireAiAllowance } from '../ai/ai.middleware.js';
import { analyzeConversationBodySchema } from './conversation-analysis.validation.js';
import * as controllers from './conversation-analysis.controller.js';

export const conversationAnalysisRouter = Router({ mergeParams: true });
conversationAnalysisRouter.use(permit('vendor.cx.view'), requireAiAllowance);
conversationAnalysisRouter.post(
  '/analyze-conversation',
  validate(analyzeConversationBodySchema),
  controllers.requestConversationAnalysis,
);
conversationAnalysisRouter.get(
  '/conversation-analysis/:conversationId',
  controllers.getConversationAnalysis,
);
