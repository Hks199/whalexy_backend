import Joi from 'joi';

export const idSchema = Joi.number().integer().positive().max(2147483647).required();
export const phoneSchema = Joi.string().pattern(/^\+[1-9]\d{7,14}$/);
export const pageSchema = Joi.object({
  page: Joi.number().integer().min(1).max(10000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
});
