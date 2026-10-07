import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireSiteAdministrator } from './translations.middleware.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-translations.validation.js';
import * as controllers from './legacy-translations.controller.js';
export const legacyTranslationsRouter = Router();
legacyTranslationsRouter.use(
  authenticate,
  requireSiteAdministrator,
  validate(schemas.emptyQuery, 'query'),
);
legacyTranslationsRouter.get('/', controllers.languages);
legacyTranslationsRouter.get(
  '/language/:languageId',
  validate(schemas.params, 'params'),
  controllers.messages,
);
legacyTranslationsRouter.post(
  '/process-language-store',
  validate(schemas.createBody),
  controllers.create,
);
legacyTranslationsRouter.post(
  '/process-language-update',
  validate(schemas.updateBody),
  controllers.update,
);
legacyTranslationsRouter.post(
  '/:languageId/process-language-delete',
  validate(schemas.params, 'params'),
  validate(schemas.deleteBody),
  controllers.remove,
);
legacyTranslationsRouter.post('/update', validate(schemas.messageBody), controllers.updateMessage);
