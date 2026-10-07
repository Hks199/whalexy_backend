import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { mediaUrlSchema } from '../messaging/services/media-message.js';

export const fields = [
  'customerName',
  'invoiceNumber',
  'invoiceTitle',
  'invoiceAmount',
  'invoiceDate',
  'companyName',
];
export const field = Joi.string().valid(...fields);
export const invoiceSchema = Joi.object({
  sourceId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
  contactId: idSchema,
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  templateId: idSchema,
  invoiceNumber: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
  invoiceAmount: Joi.string()
    .pattern(/^\d{1,9}(\.\d{1,4})?$/)
    .required(),
  currency: Joi.string()
    .pattern(/^[A-Z]{3}$/)
    .required(),
  invoiceDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  customerName: Joi.string().trim().min(1).max(150),
  pdfUrl: mediaUrlSchema,
  bodyFields: Joi.array().items(field).max(20),
  headerFields: Joi.array().items(field).max(1).default([]),
});
export const ingestTallyInvoiceBodySchema = invoiceSchema;
export const getTallyInvoiceStatusParamsSchema = Joi.object({
  vendorId: idSchema,
  sourceId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
});
