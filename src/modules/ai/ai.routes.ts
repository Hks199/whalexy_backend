import * as middleware from './ai.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  generateAiReplyBodySchema,
  deleteKnowledgeDocumentParamsSchema,
  requestAiSupportBodySchema,
} from './ai.validation.js';
import * as controllers from './ai.controller.js';

export const aiRouter = Router({ mergeParams: true });
aiRouter.use(permit('vendor.ai.manage'), middleware.requireAiAllowance);
aiRouter.post('/reply', validate(generateAiReplyBodySchema), controllers.generateAiReply);
aiRouter.get('/knowledge', controllers.listKnowledgeDocuments);
aiRouter.delete(
  '/knowledge/:id',
  validate(deleteKnowledgeDocumentParamsSchema, 'params'),
  controllers.deleteKnowledgeDocument,
);
aiRouter.post('/support', validate(requestAiSupportBodySchema), controllers.requestAiSupport);
