import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const conversationIdSchema = Joi.alternatives()
  .try(idSchema, Joi.string().uuid())
  .required();
export const legacyCxConversationParamsSchema = Joi.object({
  conversationId: conversationIdSchema,
});
export const legacyCxScoreQuerySchema = Joi.object({ score: idSchema.optional() });
export const legacyCxRetryParamsSchema = Joi.object({ scoreId: idSchema });
export const legacyCxRetryBodySchema = Joi.object({});
