import Joi from 'joi';
import { idSchema, phoneSchema, pageSchema } from '../../validation/common.js';

export const schema = Joi.object({
  firstName: Joi.string().trim().max(100).allow(''),
  lastName: Joi.string().trim().max(100).allow(''),
  phone: phoneSchema.required(),
  email: Joi.string().email().max(254).allow(null),
  languageCode: Joi.string()
    .pattern(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/)
    .allow(null),
  countryId: idSchema.optional().allow(null),
  platform: Joi.string().valid('whatsapp').default('whatsapp'),
});
export const scopedSchema = schema.keys({ phoneNumberId: Joi.string().pattern(/^\d{5,100}$/) });
export const listContactsQuerySchema = pageSchema.keys({ search: Joi.string().max(100).allow('') });
export const createContactBodySchema = scopedSchema;
export const getContactParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const updateContactParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const updateContactBodySchema = scopedSchema
  .fork(['phone'], (s) => s.optional())
  .prefs({ noDefaults: true })
  .min(1);
export const assignContactParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const assignContactBodySchema = Joi.object({ userId: idSchema.allow(null) });
export const resolveContactConversationBodySchema = Joi.object({
  resolved: Joi.boolean().required(),
});
export const updateContactAiSettingsBodySchema = Joi.object({ enabled: Joi.boolean().required() });
export const updateContactMarketingConsentBodySchema = Joi.object({
  optedOut: Joi.boolean().required(),
});
export const listContactMessagesQuerySchema = pageSchema;
export const addContactToGroupsBodySchema = Joi.object({ groupId: idSchema });
