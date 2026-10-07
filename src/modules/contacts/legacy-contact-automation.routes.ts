import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-contact-automation.validation.js';
import * as controllers from './legacy-contact-automation.controller.js';
export const legacyContactAutomationRouter = Router();
legacyContactAutomationRouter.use(authenticateLegacyWorkspace);
legacyContactAutomationRouter.post(
  '/:contactIdOrUid/toggle-ai-bot',
  permit('vendor.ai.manage'),
  validate(schemas.paramsSchema, 'params'),
  validate(schemas.bodySchema),
  controllers.toggle,
);
