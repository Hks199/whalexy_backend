import Joi from 'joi';
const color = Joi.string()
  .trim()
  .pattern(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/)
  .allow('', null);
const title = Joi.string().trim().min(1).max(45);
export const createContactLabelSchema = Joi.object({
  title: title.required(),
  textColor: color,
  bgColor: color,
  color,
  status: Joi.number().integer().valid(1, 2),
});
export const updateContactLabelSchema = createContactLabelSchema
  .fork('title', (s) => s.optional())
  .min(1);
export const legacyLabelCreateSchema = Joi.object({
  title: title.required(),
  text_color: color.default(null),
  bg_color: color.default(null),
});
export const legacyLabelUpdateSchema = legacyLabelCreateSchema.keys({
  labelUid: Joi.string().uuid().required(),
});
export const legacyLabelDeleteParamsSchema = Joi.object({
  labelUid: Joi.string().uuid().required(),
});
export const legacyLabelDeleteBodySchema = Joi.object({ labelUid: Joi.string().uuid() }).default(
  {},
);
