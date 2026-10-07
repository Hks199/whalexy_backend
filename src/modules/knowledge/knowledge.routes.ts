import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { requireAiAllowance } from '../ai/ai.middleware.js';
import { knowledgeUpload } from './knowledge.middleware.js';
import * as controllers from './knowledge.controller.js';
import {
  addKnowledgeWebsiteBodySchema,
  knowledgeDocumentParamsSchema,
} from './knowledge.validation.js';

export const knowledgeRouter = Router({ mergeParams: true });
knowledgeRouter.use(permit('vendor.ai.manage'), requireAiAllowance);
knowledgeRouter.post(
  '/upload',
  knowledgeUpload.single('file'),
  controllers.uploadKnowledgeDocument,
);
knowledgeRouter.post(
  '/website',
  validate(addKnowledgeWebsiteBodySchema),
  controllers.addKnowledgeWebsite,
);
knowledgeRouter.get('/list', controllers.listKnowledgeDocuments);
knowledgeRouter.delete(
  '/:documentId',
  validate(knowledgeDocumentParamsSchema, 'params'),
  controllers.deleteKnowledgeDocument,
);
