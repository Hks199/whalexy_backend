import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const slugSchema = Joi.string()
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(255);
export const blogPostParamsSchema = Joi.object({ id: idSchema });
export const postSchema = Joi.object({
  title: Joi.string().trim().min(3).max(255).required(),
  slug: slugSchema,
  excerpt: Joi.string().trim().min(10).max(500).required(),
  content: Joi.string().min(20).max(500000).required(),
  authorName: Joi.string().trim().max(120).allow(null, ''),
  locale: Joi.string().max(10).default('en'),
  categoryId: Joi.number().integer().positive().max(2147483647).allow(null),
  tagIds: Joi.array().items(idSchema).unique().max(100).default([]),
  intent: Joi.string().valid('draft', 'preview', 'publish', 'schedule').default('draft'),
  scheduledAt: Joi.when('intent', {
    is: 'schedule',
    then: Joi.date().iso().greater('now').required(),
    otherwise: Joi.valid(null),
  }),
  seoTitle: Joi.string().max(70).allow(null, ''),
  metaDescription: Joi.string().max(170).allow(null, ''),
  metaKeywords: Joi.string().max(500).allow(null, ''),
  canonicalUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(255)
    .allow(null),
  ogTitle: Joi.string().max(95).allow(null, ''),
  ogDescription: Joi.string().max(250).allow(null, ''),
});
export const taxonomySchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  description: Joi.string().max(2000).allow(null),
  status: Joi.boolean().default(true),
});
export const pageBody = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  slug: Joi.string().alphanum().max(255).required(),
  content: Joi.string().max(500000).allow('').required(),
  status: Joi.number().valid(0, 1).default(0),
  showInMenu: Joi.number().valid(0, 1).default(0),
});
export const listPublicBlogPostsQuerySchema = pageSchema.keys({
  limit: Joi.number().integer().min(1).max(100).default(9),
  search: Joi.string().trim().max(200),
  category: slugSchema,
});
export const getPublicBlogPostParamsSchema = Joi.object({ slug: slugSchema.required() });
export const listAdminBlogPostsQuerySchema = pageSchema.keys({
  status: Joi.string().valid('draft', 'published', 'scheduled'),
  search: Joi.string().trim().max(200),
});
export const createBlogPostBodySchema = postSchema;
export const updateBlogPostBodySchema = postSchema;
export const changeBlogPostStateBodySchema = Joi.object({});
export function taxonomyBodySchema(model: 'blogTags' | 'blogCategories') {
  return model === 'blogTags'
    ? Joi.object({ name: Joi.string().trim().min(1).max(150).required() })
    : taxonomySchema;
}
export const createBlogTaxonomyBodySchema = taxonomyBodySchema;
export const updateBlogTaxonomyBodySchema = taxonomyBodySchema;
export const getPublicPageParamsSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-zA-Z0-9-]+$/)
    .max(255)
    .required(),
});
export const listPublicPagesQuerySchema = pageSchema;
export const createPageBodySchema = pageBody;
export const updatePageBodySchema = pageBody;
