import Joi from 'joi';
import { idSchema } from '../../validation/common.js';

export const ids = Joi.array().items(idSchema.optional()).unique().max(500).required();
export const updateContactNotesBodySchema = Joi.object({
  notes: Joi.string().max(10000).allow('').required(),
});
export const updateContactLabelsBodySchema = Joi.object({ labelIds: ids });
export const updateContactCustomValuesBodySchema = Joi.object({
  values: Joi.array()
    .items(
      Joi.object({ fieldId: idSchema, value: Joi.string().max(4000).allow('', null).required() }),
    )
    .unique('fieldId')
    .max(100)
    .required(),
});
export const assignContactBodySchema = Joi.object({ userId: idSchema.allow(null) });
export const mergeContactsBodySchema = Joi.object({ targetGroupId: idSchema });
export const archiveContactBodySchema = Joi.object({ archived: Joi.boolean().required() });
export const importContactsBodySchema = Joi.object({
  csv: Joi.string().max(900000).required(),
  groupId: idSchema.optional(),
  phoneNumberId: Joi.string().pattern(/^\d{5,100}$/),
});
export const exportContactsQuerySchema = Joi.object({ extended: Joi.boolean().default(false) });
