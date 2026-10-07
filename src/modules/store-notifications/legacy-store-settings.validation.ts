import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { types } from './store-notifications.validation.js';
export const sourceTypes = [...types, 'delivery_confirmation', 'cod_verification'];
const mapping = Joi.object()
  .pattern(/^(?:[1-9]|1[0-9]|20)$/, Joi.string().max(80))
  .max(20);
export const mappingsSchema = Joi.object()
  .pattern(Joi.string().valid(...sourceTypes), mapping)
  .max(sourceTypes.length);
const common = {
  notification_types: Joi.array()
    .items(Joi.string().valid(...sourceTypes))
    .unique()
    .max(sourceTypes.length)
    .required(),
  template_uid: Joi.object()
    .pattern(Joi.string().valid(...sourceTypes), Joi.string().guid().allow('', null))
    .max(sourceTypes.length)
    .default({}),
  phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
};
export const shopifyBody = Joi.object({
  ...common,
  variable_mappings: Joi.string().max(20000).allow(''),
});
export const wooBody = Joi.object({ ...common, variable_mapping: mappingsSchema.default({}) });
export const querySchema = Joi.object({ integration_id: idSchema.optional() });
