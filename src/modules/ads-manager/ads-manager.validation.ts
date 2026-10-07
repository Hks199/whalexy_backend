import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';
import { adDate } from './services/ad-insights.js';

export const numeric = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const accountParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const rangeQuery = Joi.object({
  from: adDate.required(),
  to: adDate.required(),
  accountId: idSchema.optional(),
});
export const connectAdAccountBodySchema = Joi.object({
  accountId: numeric,
  accessToken: Joi.string().min(20).max(4096).required(),
});
export const syncAdStructureBodySchema = Joi.object({});
export const syncAdInsightsBodySchema = Joi.object({
  from: adDate.required(),
  to: adDate.required(),
});
export const listAdCampaignsQuerySchema = pageSchema.keys({
  accountId: idSchema.optional(),
  search: Joi.string().max(200),
  status: Joi.string().valid('active', 'paused', 'archived', 'draft'),
});
export const updateAdCampaignStatusBodySchema = Joi.object({
  status: Joi.string().valid('active', 'paused').required(),
});
export const getAdDashboardQuerySchema = rangeQuery;
export const exportAdReportQuerySchema = rangeQuery;
export const recordAdConversionBodySchema = Joi.object({
  campaignId: idSchema.optional(),
  contactId: idSchema.optional(),
  externalId: Joi.string().trim().min(1).max(191).required(),
  type: Joi.string()
    .valid('lead', 'appointment', 'demo', 'purchase', 'payment', 'signup', 'refund', 'cancellation')
    .required(),
  value: Joi.string()
    .pattern(/^\d{1,14}(?:\.\d{1,4})?$/)
    .default('0'),
  currency: Joi.string()
    .pattern(/^[A-Z]{3}$/)
    .required(),
  occurredAt: Joi.date().iso().max('now').required(),
}).or('campaignId', 'contactId');
export const getContactAdAttributionsQuerySchema = pageSchema;
