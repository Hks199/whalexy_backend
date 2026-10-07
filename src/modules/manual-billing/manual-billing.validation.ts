import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const listManualSubscriptionsQuerySchema = pageSchema;
export const quoteManualSubscriptionBodySchema = Joi.object({
  planId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
  paymentMethod: Joi.string().valid('bank_transfer', 'upi').required(),
});
export const useManualIdParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const submitManualPaymentBodySchema = Joi.object({
  transactionReference: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]{4,100}$/)
    .required(),
  receiptId: Joi.string().uuid().required(),
});
export const cancelManualPaymentBodySchema = Joi.object({});
