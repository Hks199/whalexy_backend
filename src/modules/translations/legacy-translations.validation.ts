import Joi from 'joi';
import { localeId } from './services/translations.js';
import { revision } from './translations.validation.js';
const locale = Joi.string()
  .min(2)
  .max(15)
  .pattern(/^[A-Za-z0-9_-]+$/)
  .custom((v, h) => {
    try {
      return localeId(v);
    } catch {
      return h.error('any.invalid');
    }
  })
  .required();
const flag = Joi.boolean().truthy('true').falsy('false');
const languageName = Joi.string().trim().min(3).max(15).required();
export const params = Joi.object({ languageId: locale });
export const emptyQuery = Joi.object({});
export const createBody = Joi.object({
  language_id: locale,
  language_name: languageName,
  is_rtl: flag.default(false),
  auto_translate: Joi.string().valid('').allow(null),
});
export const deleteBody = Joi.object({ revision });
export const updateBody = Joi.object()
  .unknown(true)
  .custom((value, h) => {
    // Validate the submitted key before constructing dynamic original form fields.
    const rawKey = Joi.string()
      .min(2)
      .max(15)
      .pattern(/^[A-Za-z0-9_-]+$/)
      .validate(value.form_key);
    if (rawKey.error || !value.form_key) return h.error('any.invalid');
    const key = value.form_key;
    const schema = Joi.object({
      form_key: locale,
      revision,
      [`language_name_${key}`]: languageName,
      [`is_rtl_${key}`]: flag.default(false),
      [`status_${key}`]: flag.default(false),
    });
    const checked = schema.validate(value, { allowUnknown: false });
    if (checked.error) return h.error('any.invalid');
    return {
      locale: checked.value.form_key,
      revision: checked.value.revision,
      name: checked.value[`language_name_${key}`],
      isRtl: checked.value[`is_rtl_${key}`],
      status: checked.value[`status_${key}`],
    };
  });
export const messageBody = Joi.object({
  language_id: locale,
  message_id: Joi.string().min(1).max(4000).required(),
  message_str: Joi.string().max(8000).allow('', null).default(''),
  is_plural: Joi.boolean().valid(false).default(false),
  revision: Joi.string().guid().allow(null).required(),
});
