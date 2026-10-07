import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const querySchema = Joi.object({ integration_id: idSchema.optional() });
