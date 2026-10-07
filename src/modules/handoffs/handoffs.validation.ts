import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const listHandoffsQuerySchema = pageSchema.keys({
  status: Joi.string().valid('waiting', 'accepted', 'resolved'),
});
export const transferHandoffBodySchema = Joi.object({ userId: idSchema.allow(null) });
export const resolveHandoffBodySchema = Joi.object({ resumeAi: Joi.boolean().default(false) });
export const acceptContactHandoffParamsSchema = Joi.object({
  vendorId: idSchema,
  contactId: idSchema,
});
export const acceptContactHandoffBodySchema = Joi.object({});
