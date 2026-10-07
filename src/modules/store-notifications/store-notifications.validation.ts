import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { richTemplateFields } from '../../shared/templates/rich-template.js';

export const types = [
  'order_confirmation',
  'payment_confirmation',
  'shipment_tracking',
  'order_cancelled',
  'refund_processed',
  'order_processing',
  'order_completed',
  'order_on_hold',
  'order_failed',
];
export const fields = [
  'orderNumber',
  'orderId',
  'customerName',
  'total',
  'currency',
  'status',
  'trackingNumber',
  'trackingUrl',
];
export const valueSchema = Joi.object({
  literal: Joi.string().min(1).max(1024),
  orderField: Joi.string().valid(...fields),
  contactField: Joi.string().valid('firstName', 'lastName', 'fullName', 'phone', 'email'),
  fallback: Joi.string().min(1).max(1024).default('-'),
}).xor('literal', 'orderField', 'contactField');
export const settingSchema = Joi.object({
  enabled: Joi.boolean().required(),
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  rules: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid(...types)
          .required(),
        templateId: idSchema,
        bodyParameters: Joi.array().items(valueSchema).max(20).default([]),
        headerParameters: Joi.array().items(valueSchema).max(1).default([]),
        ...richTemplateFields(valueSchema),
      }),
    )
    .unique('type')
    .max(types.length)
    .required(),
});
export const params = Joi.object({
  vendorId: idSchema,
  provider: Joi.string().valid('shopify', 'woocommerce').required(),
  integrationId: idSchema,
});
export const getStoreNotificationSettingsParamsSchema = params;
export const updateStoreNotificationSettingsParamsSchema = params;
export const updateStoreNotificationSettingsBodySchema = settingSchema;
