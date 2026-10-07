import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';

export const column = Joi.number().integer().min(0).max(255);
export const ruleSchema = Joi.object({
  templateId: idSchema,
  triggerValue: Joi.string().trim().min(1).max(100),
  bodyColumns: Joi.array().items(column).max(20).default([]),
  headerColumns: Joi.array().items(column).max(1).default([]),
  mediaColumn: column,
  filenameColumn: column,
  buttonColumns: Joi.object()
    .pattern(/^[0-9]$/, column)
    .max(10)
    .default({}),
  copyCodeColumn: column,
});
export const settingsSchema = Joi.object({
  title: Joi.string().trim().min(1).max(150).required(),
  spreadsheetId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{20,150}$/)
    .required(),
  sheetName: Joi.string()
    .min(1)
    .max(100)
    .pattern(/^[^\x00-\x1f]+$/)
    .required(),
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  triggerType: Joi.string().valid('new_row', 'column_value').required(),
  phoneColumn: column.required(),
  rowIdColumn: column.required(),
  triggerColumn: Joi.when('triggerType', {
    is: 'column_value',
    then: column.required(),
    otherwise: Joi.forbidden(),
  }),
  statusColumn: column,
  rules: Joi.array().items(ruleSchema).min(1).max(10).required(),
});
export const listSheetIntegrationsQuerySchema = pageSchema;
export const createSheetIntegrationBodySchema = settingsSchema;
export const useUidParamsSchema = Joi.object({
  vendorId: idSchema,
  uid: Joi.string().uuid().required(),
});
export const updateSheetStatusBodySchema = Joi.object({ enabled: Joi.boolean().required() });
export const ingestSheetRowsBodySchema = Joi.object({
  rowId: Joi.string().uuid().required(),
  row: Joi.array().items(Joi.string().max(2048).allow('')).min(1).max(256).required(),
});
