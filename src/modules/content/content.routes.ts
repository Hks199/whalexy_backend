import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { requireSiteAdministrator } from './content.middleware.js';
import {
  listPublicBlogPostsQuerySchema,
  getPublicBlogPostParamsSchema,
  listAdminBlogPostsQuerySchema,
  createBlogPostBodySchema,
  updateBlogPostBodySchema,
  changeBlogPostStateBodySchema,
  createBlogTaxonomyBodySchema,
  updateBlogTaxonomyBodySchema,
  getPublicPageParamsSchema,
  listPublicPagesQuerySchema,
  createPageBodySchema,
  updatePageBodySchema,
} from './content.validation.js';
import { validateBlogPostParams } from './content.middleware.js';
import * as controllers from './content.controller.js';

export const publicContentRouter = Router();
export const adminContentRouter = Router();
publicContentRouter.get('/blog/categories', controllers.listPublicBlogCategories);
publicContentRouter.get(
  '/blog',
  validate(listPublicBlogPostsQuerySchema, 'query'),
  controllers.listPublicBlogPosts,
);
publicContentRouter.get(
  '/blog/:slug',
  validate(getPublicBlogPostParamsSchema, 'params'),
  controllers.getPublicBlogPost,
);
adminContentRouter.use(authenticate, requireSiteAdministrator);
adminContentRouter.get(
  '/blog',
  validate(listAdminBlogPostsQuerySchema, 'query'),
  controllers.listAdminBlogPosts,
);
adminContentRouter.post('/blog', validate(createBlogPostBodySchema), controllers.createBlogPost);
adminContentRouter.put(
  '/blog/:id',
  validateBlogPostParams,
  validate(updateBlogPostBodySchema),
  controllers.updateBlogPost,
);
adminContentRouter.get('/blog/:id', validateBlogPostParams, controllers.getAdminBlogPost);
adminContentRouter.delete('/blog/:id', validateBlogPostParams, controllers.deleteBlogPost);
for (const action of ['publish', 'unpublish', 'duplicate'] as const) {
  adminContentRouter.post(
    `/blog/:id/${action}`,
    validateBlogPostParams,
    validate(changeBlogPostStateBodySchema),
    controllers.changeBlogPostState(action),
  );
}
for (const [path, model] of [
  ['categories', 'blogCategories'],
  ['tags', 'blogTags'],
] as const) {
  adminContentRouter.get(`/blog-taxonomy/${path}`, controllers.listBlogTaxonomy(model));
  adminContentRouter.post(
    `/blog-taxonomy/${path}`,
    validate(createBlogTaxonomyBodySchema(model)),
    controllers.createBlogTaxonomy(model),
  );
  adminContentRouter.put(
    `/blog-taxonomy/${path}/:id`,
    validateBlogPostParams,
    validate(updateBlogTaxonomyBodySchema(model)),
    controllers.updateBlogTaxonomy(model),
  );
  adminContentRouter.delete(
    `/blog-taxonomy/${path}/:id`,
    validateBlogPostParams,
    controllers.deleteBlogTaxonomy(model),
  );
}
publicContentRouter.get('/pages', controllers.listPublicPages);
publicContentRouter.get(
  '/pages/:slug',
  validate(getPublicPageParamsSchema, 'params'),
  controllers.getPublicPage,
);
adminContentRouter.get(
  '/pages',
  validate(listPublicPagesQuerySchema, 'query'),
  controllers.listAdminPages,
);
adminContentRouter.post('/pages', validate(createPageBodySchema), controllers.createPage);
adminContentRouter.put(
  '/pages/:id',
  validateBlogPostParams,
  validate(updatePageBodySchema),
  controllers.updatePage,
);
adminContentRouter.delete('/pages/:id', validateBlogPostParams, controllers.deletePage);
