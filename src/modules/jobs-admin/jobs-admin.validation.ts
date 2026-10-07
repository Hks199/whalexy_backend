import Joi from 'joi';
import { pageSchema } from '../../validation/common.js';

export const listJobsQuerySchema = pageSchema.keys({
  status: Joi.string().valid(
    'pending',
    'processing',
    'blocked',
    'failed',
    'uncertain',
    'cancelled',
    'completed',
  ),
});
export const retryJobBodySchema = Joi.object({});
