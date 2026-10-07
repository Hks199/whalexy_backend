import { dataTableQuerySchema } from '../../validation/data-table.js';
import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { fieldSchema, revision } from './contact-fields.validation.js';

const identifier = Joi.alternatives().try(idSchema, Joi.string().uuid()).required();
export const legacyFieldParamsSchema = Joi.object({ contactCustomFieldIdOrUid: identifier });
export const legacyFieldCreateSchema = Joi.object({
  input_name: fieldSchema.extract('inputName'),
  input_type: fieldSchema.extract('inputType'),
});
export const legacyFieldUpdateSchema = legacyFieldCreateSchema.keys({
  contactCustomFieldIdOrUid: identifier,
  revision,
});
export const legacyFieldDeleteSchema = Joi.object({ revision });
export const legacyFieldListSchema = dataTableQuerySchema([0, 1]);
