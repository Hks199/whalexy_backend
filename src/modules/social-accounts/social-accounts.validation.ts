import Joi from 'joi';

export const numeric = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const connectSocialAccountBodySchema = Joi.object({
  platform: Joi.string().valid('facebook', 'instagram').required(),
  accountId: numeric,
  pageId: numeric,
  accessToken: Joi.string().min(20).max(4096).required(),
});
