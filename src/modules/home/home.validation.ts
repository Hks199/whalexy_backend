import Joi from 'joi';
import { policies } from './home.constants.js';

export const getPublicPolicyParamsSchema = Joi.object({
  policy: Joi.string()
    .valid(...policies)
    .required(),
});
