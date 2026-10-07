import { type RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listPublicBlogCategories as listPublicBlogCategoriesService,
  listPublicBlogPosts as listPublicBlogPostsService,
  getPublicBlogPost as getPublicBlogPostService,
  listAdminBlogPosts as listAdminBlogPostsService,
  createBlogPost as createBlogPostService,
  updateBlogPost as updateBlogPostService,
  getAdminBlogPost as getAdminBlogPostService,
  deleteBlogPost as deleteBlogPostService,
  changeBlogPostState as changeBlogPostStateService,
} from './services/blog-posts.service.js';
import {
  listBlogTaxonomy as listBlogTaxonomyService,
  createBlogTaxonomy as createBlogTaxonomyService,
  updateBlogTaxonomy as updateBlogTaxonomyService,
  deleteBlogTaxonomy as deleteBlogTaxonomyService,
} from './services/blog-taxonomy.service.js';
import {
  listPublicPages as listPublicPagesService,
  getPublicPage as getPublicPageService,
  listAdminPages as listAdminPagesService,
  createPage as createPageService,
  updatePage as updatePageService,
  deletePage as deletePageService,
} from './services/site-pages.service.js';

export const listPublicBlogCategories: RequestHandler = async (req, res) => {
  sendResult(res, await listPublicBlogCategoriesService(serviceContext(req, res)));
};
export const listPublicBlogPosts: RequestHandler = async (req, res) => {
  sendResult(res, await listPublicBlogPostsService(serviceContext(req, res)));
};
export const getPublicBlogPost: RequestHandler = async (req, res) => {
  sendResult(res, await getPublicBlogPostService(serviceContext(req, res)));
};
export const listAdminBlogPosts: RequestHandler = async (req, res) => {
  sendResult(res, await listAdminBlogPostsService(serviceContext(req, res)));
};
export const createBlogPost: RequestHandler = async (req, res) => {
  sendResult(res, await createBlogPostService(serviceContext(req, res)));
};
export const updateBlogPost: RequestHandler = async (req, res) => {
  sendResult(res, await updateBlogPostService(serviceContext(req, res)));
};
export const getAdminBlogPost: RequestHandler = async (req, res) => {
  sendResult(res, await getAdminBlogPostService(serviceContext(req, res)));
};
export const deleteBlogPost: RequestHandler = async (req, res) => {
  sendResult(res, await deleteBlogPostService(serviceContext(req, res)));
};
export const changeBlogPostState =
  (action: 'publish' | 'unpublish' | 'duplicate'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await changeBlogPostStateService(serviceContext(req, res), action));
  };
export const listBlogTaxonomy =
  (model: 'blogCategories' | 'blogTags'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await listBlogTaxonomyService(serviceContext(req, res), model));
  };
export const createBlogTaxonomy =
  (model: 'blogCategories' | 'blogTags'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await createBlogTaxonomyService(serviceContext(req, res), model));
  };
export const updateBlogTaxonomy =
  (model: 'blogCategories' | 'blogTags'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await updateBlogTaxonomyService(serviceContext(req, res), model));
  };
export const deleteBlogTaxonomy =
  (model: 'blogCategories' | 'blogTags'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await deleteBlogTaxonomyService(serviceContext(req, res), model));
  };
export const listPublicPages: RequestHandler = async (req, res) => {
  sendResult(res, await listPublicPagesService(serviceContext(req, res)));
};
export const getPublicPage: RequestHandler = async (req, res) => {
  sendResult(res, await getPublicPageService(serviceContext(req, res)));
};
export const listAdminPages: RequestHandler = async (req, res) => {
  sendResult(res, await listAdminPagesService(serviceContext(req, res)));
};
export const createPage: RequestHandler = async (req, res) => {
  sendResult(res, await createPageService(serviceContext(req, res)));
};
export const updatePage: RequestHandler = async (req, res) => {
  sendResult(res, await updatePageService(serviceContext(req, res)));
};
export const deletePage: RequestHandler = async (req, res) => {
  sendResult(res, await deletePageService(serviceContext(req, res)));
};
