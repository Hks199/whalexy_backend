import Joi from 'joi';
export const legacySelectedContactDeleteBodySchema = Joi.object({
  selected_contacts: Joi.array().items(Joi.string().uuid()).unique().min(1).max(100).required(),
});
export const legacyFilteredContactDeleteBodySchema = Joi.object({
  search: Joi.string().trim().max(255).allow('').default(''),
  platform: Joi.string().valid('whatsapp', 'instagram', 'facebook').default('whatsapp'),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
}).default({});
export const legacyFilteredContactDeleteParamsSchema = Joi.object({
  groupUid: Joi.string().uuid(),
});
