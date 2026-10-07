import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const paramsSchema = Joi.object({ notificationId: idSchema });
export const bodySchema = Joi.object({}).default({});
