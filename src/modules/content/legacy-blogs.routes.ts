import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { requireSiteAdministrator } from './content.middleware.js';
import * as schemas from './legacy-blogs.validation.js';
import * as controllers from './legacy-blogs.controller.js';
export const legacyBlogsRouter = Router();
legacyBlogsRouter.use(authenticate, requireSiteAdministrator);
legacyBlogsRouter.get('/', validate(schemas.listQuery, 'query'), controllers.list);
legacyBlogsRouter.get('/create', validate(schemas.empty, 'query'), controllers.editor('create'));
legacyBlogsRouter.post(
  '/',
  validate(schemas.empty, 'query'),
  validate(schemas.postBody()),
  controllers.mutate('create'),
);
legacyBlogsRouter.get(
  '/:blog/edit',
  validate(schemas.params, 'params'),
  validate(schemas.empty, 'query'),
  controllers.editor('edit'),
);
legacyBlogsRouter.get(
  '/:blog/preview',
  validate(schemas.params, 'params'),
  validate(schemas.empty, 'query'),
  controllers.editor('preview'),
);
legacyBlogsRouter.put(
  '/:blog',
  validate(schemas.params, 'params'),
  validate(schemas.empty, 'query'),
  validate(schemas.postBody(true)),
  controllers.mutate('update'),
);
legacyBlogsRouter.delete(
  '/:blog',
  validate(schemas.params, 'params'),
  validate(schemas.empty, 'query'),
  validate(schemas.mutation),
  controllers.mutate('delete'),
);
for (const action of ['duplicate', 'publish', 'unpublish'] as const)
  legacyBlogsRouter.post(
    `/:blog/${action}`,
    validate(schemas.params, 'params'),
    validate(schemas.empty, 'query'),
    validate(schemas.mutation),
    controllers.mutate(action),
  );
