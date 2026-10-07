import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';
import { parameterSchema } from '../../shared/templates/template-values.js';
import { richTemplateFields } from '../../shared/templates/rich-template.js';

export const optionsSchema = Joi.object({
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  groupIds: Joi.array().items(idSchema.optional()).unique().max(100).default([]),
  allContacts: Joi.boolean().default(false),
  phoneNumbers: Joi.array()
    .items(Joi.string().pattern(/^[1-9]\d{9,14}$/))
    .unique()
    .max(1000)
    .default([]),
  requireTest: Joi.boolean().default(true),
  restrictLanguage: Joi.boolean().default(false),
  bodyParameters: Joi.array().items(parameterSchema).max(20).default([]),
  headerParameters: Joi.array().items(parameterSchema).max(1).default([]),
  ...richTemplateFields(parameterSchema),
}).custom((value, helpers) =>
  (!value.allContacts && !value.groupIds.length && !value.phoneNumbers.length) ||
  (value.allContacts && value.groupIds.length)
    ? helpers.error('any.invalid')
    : value,
);
export const listCampaignsQuerySchema = pageSchema.keys({ archived: Joi.boolean().default(false) });
export const createCampaignBodySchema = optionsSchema.keys({
  title: Joi.string().trim().min(1).max(160).required(),
  templateId: idSchema,
  scheduledAt: Joi.date().iso().greater('now').required(),
});
export const duplicateCampaignBodySchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).required(),
  scheduledAt: Joi.date().iso().greater('now').required(),
});
export const sendCampaignTestBodySchema = Joi.object({ contactId: idSchema.optional() });
export const listCampaignRecipientsQuerySchema = pageSchema;
