import Joi from 'joi';

export const numeric = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const startMetaSignupBodySchema = Joi.object({});
export const completeMetaSignupBodySchema = Joi.object({
  state: Joi.string().min(40).max(128).required(),
  code: Joi.string().min(1).max(4096).required(),
  wabaId: numeric,
  phoneNumberId: numeric,
  pin: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
});
