import Joi from 'joi';
import { messagesSchema } from './services/translations.js';

export const paramsSchema = Joi.object({ locale: Joi.string().max(35).required() });
export const revision = Joi.string().hex().length(64).required();
export const createLanguageBodySchema = Joi.object({
  locale: Joi.string().max(35).required(),
  name: Joi.string().trim().min(2).max(80).required(),
  isRtl: Joi.boolean().strict().default(false),
});
export const updateLanguageBodySchema = Joi.object({
  revision,
  name: Joi.string().trim().min(2).max(80),
  status: Joi.boolean().strict(),
  isRtl: Joi.boolean().strict(),
}).or('name', 'status', 'isRtl');
export const deleteLanguageBodySchema = Joi.object({ revision });
export const updateLanguageMessagesBodySchema = Joi.object({
  revision: Joi.string().guid().allow(null).required(),
  messages: messagesSchema,
});
export const importLanguagePoBodySchema = Joi.object({
  revision: Joi.string().guid().allow('').required(),
});
