import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireSiteAdministrator } from './content.middleware.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-pages.validation.js';
import * as controllers from './legacy-pages.controller.js';
export const legacyPagesRouter = Router();
legacyPagesRouter.use(authenticate, requireSiteAdministrator);
legacyPagesRouter.get('/', validate(schemas.tableQuery, 'query'), controllers.list);
legacyPagesRouter.get('/list-data', validate(schemas.tableQuery, 'query'), controllers.list);
legacyPagesRouter.get(
  '/:pageIdOrUid/get-update-data',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  controllers.edit,
);
legacyPagesRouter.post(
  '/add-process',
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.createBody),
  controllers.create,
);
legacyPagesRouter.post(
  '/update-process',
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.updateBody),
  controllers.update,
);
legacyPagesRouter.post(
  '/:pageIdOrUid/delete-process',
  validate(schemas.params, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.deleteBody),
  controllers.remove,
);
