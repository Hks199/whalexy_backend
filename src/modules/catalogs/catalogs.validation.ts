import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const numeric = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const productSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  sku: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().min(1).max(5000).required(),
  price: Joi.string()
    .pattern(/^\d{1,12}\.\d{1,4}$/)
    .required(),
  currency: Joi.string().valid('USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD').required(),
  availability: Joi.string()
    .valid('in_stock', 'out_of_stock', 'preorder', 'available_for_order', 'discontinued')
    .default('in_stock'),
  condition: Joi.string().valid('new', 'used', 'refurbished').default('new'),
  customUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .required(),
  primaryImageUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .required(),
  brand: Joi.string().trim().min(1).max(255).required(),
});
export const connectCatalogBodySchema = Joi.object({
  businessId: numeric,
  catalogIdExternal: numeric,
  phoneNumberId: numeric,
  currency: Joi.string()
    .pattern(/^[A-Z]{3}$/)
    .default('USD'),
});
export const useCatalogIdParamsSchema = Joi.object({ vendorId: idSchema, catalogId: idSchema });
export const syncCatalogBodySchema = Joi.object({
  maxPages: Joi.number().integer().min(1).max(50).default(50),
});
export const listCatalogProductsQuerySchema = pageSchema;
export const createCatalogProductBodySchema = productSchema;
export const updateCatalogProductBodySchema = productSchema;
export const publishCatalogProductBodySchema = Joi.object({});
