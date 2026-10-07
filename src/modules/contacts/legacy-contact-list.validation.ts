import Joi from 'joi';
import { pageSchema } from '../../validation/common.js';
export const legacyContactListQuerySchema = pageSchema.keys({
  search: Joi.string().max(100).allow(''),
  assigned: Joi.string().valid('all', 'mine', 'unassigned'),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
  request_contact: Joi.boolean(),
});
