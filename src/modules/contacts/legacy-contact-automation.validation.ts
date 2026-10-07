import Joi from 'joi';
export const paramsSchema = Joi.object({ contactIdOrUid: Joi.string().uuid().required() });
export const bodySchema = Joi.object({}).default({});
