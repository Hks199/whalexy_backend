import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const legacyContactRecordParamsSchema = Joi.object({
  contactIdOrUid: Joi.alternatives().try(idSchema, Joi.string().uuid()).required(),
});
export const legacyContactDeleteBodySchema = Joi.object({});
const fields = {
  first_name: Joi.string().trim().max(100).allow('', null),
  last_name: Joi.string().trim().max(100).allow('', null),
  phone_number: Joi.string().pattern(/^[1-9]\d{8,14}$/),
  email: Joi.string().email().max(254).allow('', null),
  language_code: Joi.string()
    .pattern(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/)
    .allow('', null),
  country: idSchema.optional().allow(null),
  wab_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
  contact_groups: Joi.array().items(idSchema.optional()).unique().max(50),
  custom_input_fields: Joi.object()
    .pattern(Joi.string().uuid(), Joi.string().max(4000).allow('', null))
    .max(100),
  whatsapp_opt_out: Joi.boolean().truthy('1').falsy('0'),
  enable_ai_bot: Joi.boolean().truthy('1').falsy('0'),
};
export const legacyContactCreateBodySchema = Joi.object(fields).keys({
  phone_number: fields.phone_number.required(),
});
export const legacyContactUpdateBodySchema = Joi.object(fields)
  .keys({ contactIdOrUid: Joi.string().uuid().required() })
  .min(2);
