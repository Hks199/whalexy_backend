import Joi from 'joi';

export const planSchema = Joi.array()
  .items(
    Joi.object({
      id: Joi.string()
        .pattern(/^[A-Za-z0-9_-]{1,100}$/)
        .required(),
      title: Joi.string().max(100).required(),
      priceId: Joi.string()
        .pattern(/^price_[A-Za-z0-9]{1,200}$/)
        .required(),
      interval: Joi.string().valid('monthly', 'half_yearly', 'yearly').required(),
      amount: Joi.number().integer().min(0).max(2147483647).required(),
      currency: Joi.string()
        .pattern(/^[A-Z]{3}$/)
        .required(),
      manualPayments: Joi.boolean().default(false),
    }),
  )
  .unique('id')
  .max(100);
export const createCheckoutSessionBodySchema = Joi.object({
  planId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
});
export const createBillingPortalSessionBodySchema = Joi.object({});
export const listBillingInvoicesQuerySchema = Joi.object({
  startingAfter: Joi.string().pattern(/^in_[A-Za-z0-9_]{1,200}$/),
  limit: Joi.number().integer().min(1).max(100).default(100),
});
