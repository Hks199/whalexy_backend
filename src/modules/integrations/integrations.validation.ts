import Joi from 'joi';
import { idSchema } from '../../validation/common.js';

export const connectMetaIntegrationBodySchema = Joi.object({
  provider: Joi.string().valid('whatsapp', 'facebook', 'instagram').required(),
  externalId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  accessToken: Joi.string().min(20).max(4096).required(),
  wabaId: Joi.string().pattern(/^\d{5,100}$/),
});
export const connectStoreIntegrationBodySchema = Joi.object({
  provider: Joi.string().valid('shopify', 'woocommerce').required(),
  externalId: Joi.string().hostname().lowercase().max(253).required(),
  webhookSecret: Joi.string().min(32).max(512).required(),
  integrationId: idSchema.optional(),
});
export const syncMessageTemplatesBodySchema = Joi.object({
  phoneNumberId: Joi.string().pattern(/^\d+$/).required(),
  wabaId: Joi.string().pattern(/^\d+$/).required(),
  after: Joi.string().max(4096),
  maxPages: Joi.number().integer().min(1).max(100).default(10),
});
