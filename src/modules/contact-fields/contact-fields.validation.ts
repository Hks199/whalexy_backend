import Joi from 'joi';
import { contactValueTypes } from '../contacts/services/contact-values.js';
import { csvFieldNameAllowed } from '../contacts/services/contact-csv.js';
import { pageSchema } from '../../validation/common.js';

export const revision = Joi.string().isoDate().required();
export const fieldSchema = Joi.object({
  inputName: Joi.string()
    .max(64)
    .required()
    .custom((v, h) => (csvFieldNameAllowed(v) ? v : h.error('any.invalid'))),
  inputType: Joi.string()
    .valid(...contactValueTypes)
    .required(),
  name: Joi.string().trim().max(200).allow('', null),
});
export const patchSchema = fieldSchema
  .fork(['inputName', 'inputType'], (s) => s.optional())
  .keys({ revision })
  .min(2);
export const listContactFieldsQuerySchema = pageSchema;
export const createContactFieldBodySchema = fieldSchema;
export const updateContactFieldBodySchema = patchSchema;
export const deleteContactFieldBodySchema = Joi.object({ revision });
