import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const attributes = {
  intent: 'intent',
  sentiment: 'sentiment',
  urgency: 'urgency',
  risk_level: 'riskLevel',
} as const;
export const kind = Joi.string()
  .valid(...Object.keys(attributes))
  .required();
export const tags = Joi.object({
  type: kind,
  name: Joi.string().trim().min(1).max(100).required(),
  color: Joi.string()
    .pattern(/^#[0-9a-fA-F]{6}$/)
    .default('#64748b'),
  icon: Joi.string()
    .pattern(/^fa-[a-z0-9-]{1,45}$/)
    .default('fa-tag'),
  category: Joi.string().trim().min(1).max(50).default('Custom'),
});
export const getContactClassificationParamsSchema = Joi.object({
  vendorId: idSchema,
  id: idSchema,
});
export const getContactClassificationQuerySchema = pageSchema;
export const updateContactClassificationParamsSchema = Joi.object({
  vendorId: idSchema,
  id: idSchema,
});
export const updateContactClassificationBodySchema = Joi.object({
  attribute: kind,
  value: Joi.string().trim().min(1).max(100).allow(null).required(),
});
export const createClassificationTagBodySchema = tags;
export const deleteClassificationTagParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
