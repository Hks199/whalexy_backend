import Joi from 'joi';
import { dataTableQuerySchema } from '../../validation/data-table.js';
export const legacyContactDirectoryParamsSchema = Joi.object({ groupUid: Joi.string().uuid() });
export const legacyContactDirectoryQuerySchema = dataTableQuerySchema([2, 3, 9, 11, 12, 13]).keys({
  platform: Joi.string().valid('whatsapp', 'instagram', 'facebook').default('whatsapp'),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
});
