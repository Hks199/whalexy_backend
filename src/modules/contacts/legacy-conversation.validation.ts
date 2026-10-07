import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const legacyConversationParamsSchema = Joi.object({
  conversationId: Joi.alternatives().try(idSchema, Joi.string().uuid()).required(),
});
export const legacyConversationBodySchema = Joi.object({});
