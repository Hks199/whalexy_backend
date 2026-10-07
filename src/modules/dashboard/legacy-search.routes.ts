import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { validate } from '../../middleware/validation.js';
import { requireSiteAdministrator } from '../content/content.middleware.js';
import { query } from './legacy-search.validation.js';
import * as controllers from './legacy-search.controller.js';
export const legacyVendorSearchRouter = Router();
export const legacyCentralSearchRouter = Router();
legacyVendorSearchRouter.get(
  '/global-search',
  authenticateLegacyWorkspace,
  validate(query, 'query'),
  controllers.vendor,
);
legacyCentralSearchRouter.get(
  '/global-search',
  authenticate,
  requireSiteAdministrator,
  validate(query, 'query'),
  controllers.central,
);
