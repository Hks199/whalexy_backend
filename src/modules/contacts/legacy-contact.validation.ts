import Joi from 'joi';

export const legacyContactPhoneSchema = Joi.string().pattern(/^[1-9]\d{8,14}$/);
const fields = {
  first_name: Joi.string().trim().max(150).allow('', null),
  last_name: Joi.string().trim().max(150).allow('', null),
  email: Joi.string().email({ tlds: false }).max(254).allow('', null),
  language_code: Joi.string()
    .max(20)
    .pattern(/^[A-Za-z0-9_-]+$/)
    .allow('', null),
  country: Joi.string().trim().max(200).allow('', null),
  phone_number: legacyContactPhoneSchema,
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
  groups: Joi.string()
    .max(10000)
    .allow('')
    .custom((value, helpers) => {
      const titles = value
        .split(',')
        .map((title: string) => title.trim())
        .filter(Boolean);
      return titles.length <= 100 && titles.every((title: string) => title.length <= 255)
        ? value
        : helpers.error('any.invalid');
    }),
  custom_input_fields: Joi.object()
    .pattern(Joi.string().guid(), Joi.string().max(4000).allow('', null))
    .max(100),
  whatsapp_opt_out: Joi.boolean(),
  enable_ai_bot: Joi.boolean(),
};
export const legacyCreateContactBodySchema = Joi.object({
  ...fields,
  phone_number: legacyContactPhoneSchema.required(),
});
export const legacyUpdateContactBodySchema = Joi.object(fields).min(1);
