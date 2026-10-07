import Joi from 'joi';
import { idSchema } from '../../validation/common.js';

export const vendorBillingParamsSchema = Joi.object({
  vendorId: idSchema,
});
export const reviewManualSubscriptionParamsSchema = Joi.object({
  vendorId: idSchema,
  id: idSchema,
});
export const reviewManualSubscriptionBodySchema = (action: 'approve' | 'reject') =>
  action === 'approve'
    ? Joi.object({ endsAt: Joi.date().iso().greater('now') })
    : Joi.object({ reason: Joi.string().trim().min(1).max(1000).required() });
export const getManualIdReceiptParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const overrideAiReplyAllowanceBodySchema = Joi.object({
  expiresAt: Joi.date().iso().greater('now').allow(null).default(null),
});
