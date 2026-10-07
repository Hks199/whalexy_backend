import * as middleware from './translations.middleware.js';
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { translationUpload } from './translations.middleware.js';
import {
  createLanguageBodySchema,
  updateLanguageBodySchema,
  deleteLanguageBodySchema,
  updateLanguageMessagesBodySchema,
  importLanguagePoBodySchema,
} from './translations.validation.js';
import { validateLocaleParams } from './translations.middleware.js';
import * as controllers from './translations.controller.js';

export const publicTranslationsRouter = Router();
export const adminTranslationsRouter = Router();
publicTranslationsRouter.get('/', controllers.listPublicLanguages);
publicTranslationsRouter.get('/:locale', validateLocaleParams, controllers.getPublicLanguage);
adminTranslationsRouter.use(authenticate, middleware.requireSiteAdministrator);
adminTranslationsRouter.get('/', controllers.listAdminLanguages);
adminTranslationsRouter.post('/', validate(createLanguageBodySchema), controllers.createLanguage);
adminTranslationsRouter.patch(
  '/:locale',
  validateLocaleParams,
  validate(updateLanguageBodySchema),
  controllers.updateLanguage,
);
adminTranslationsRouter.delete(
  '/:locale',
  validateLocaleParams,
  validate(deleteLanguageBodySchema),
  controllers.deleteLanguage,
);
adminTranslationsRouter.get(
  '/:locale/messages',
  validateLocaleParams,
  controllers.getLanguageMessages,
);
adminTranslationsRouter.put(
  '/:locale/messages',
  validateLocaleParams,
  validate(updateLanguageMessagesBodySchema),
  controllers.updateLanguageMessages,
);
adminTranslationsRouter.post(
  '/:locale/import-po',
  validateLocaleParams,
  translationUpload.single('file'),
  validate(importLanguagePoBodySchema),
  controllers.importLanguagePo,
);
adminTranslationsRouter.get(
  '/:locale/export-po',
  validateLocaleParams,
  controllers.exportLanguagePo,
);
