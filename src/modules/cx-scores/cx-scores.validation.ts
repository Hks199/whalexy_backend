import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const output = Joi.object({
  cx_score: Joi.number().min(0).max(10).required(),
  summary: Joi.string().trim().min(1).max(1500).required(),
  reason: Joi.array().items(Joi.string().trim().min(1).max(180)).min(1).max(5).required(),
  recommended_action: Joi.string().trim().min(1).max(500).required(),
  rating: Joi.string().max(30),
}).unknown(false);
export const listCustomerExperienceScoresQuerySchema = pageSchema.keys({
  status: Joi.string().valid(
    'pending',
    'processing',
    'completed',
    'failed',
    'blocked',
    'uncertain',
  ),
  agentId: idSchema.optional(),
  rating: Joi.string().valid('Excellent', 'Good', 'Average', 'Poor', 'Critical'),
});
export const getCustomerExperienceScoreParamsSchema = Joi.object({
  vendorId: idSchema,
  id: idSchema,
});
export const retryCustomerExperienceScoreParamsSchema = Joi.object({
  vendorId: idSchema,
  id: idSchema,
});
export const retryCustomerExperienceScoreBodySchema = Joi.object({});
