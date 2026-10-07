import Joi from 'joi';
import { idSchema } from '../../validation/common.js';

export const generateAiReplyBodySchema = Joi.object({
  contactId: idSchema,
  message: Joi.string().min(1).max(4096).required(),
});
export const deleteKnowledgeDocumentParamsSchema = Joi.object({
  vendorId: idSchema,
  id: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
});
export const requestAiSupportBodySchema = Joi.object({
  query: Joi.string().min(1).max(2000).required(),
  history: Joi.array()
    .items(
      Joi.object({
        role: Joi.string().valid('user', 'assistant').required(),
        content: Joi.string().max(2000).required(),
      }),
    )
    .max(10)
    .default([]),
});
