import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
const workspace = { vendorId: idSchema.optional() };
const way = Joi.string().valid('append', 'prepend', 'replace').default('append');
export const historyParams = Joi.object({
  ...workspace,
  contactUid: Joi.string().uuid().required(),
  way,
});
export const historyQuery = Joi.object({
  page: Joi.number().integer().min(1).max(10000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(16),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
});
export const inboxParams = Joi.object({ ...workspace, contactUid: Joi.string().uuid() });
export const inboxQuery = historyQuery.keys({
  limit: Joi.number().integer().min(1).max(100).default(20),
  way,
  assigned: Joi.string().valid('all', 'to-me', 'unassigned').default('all'),
  search: Joi.string().trim().max(100).allow('').default(''),
  unread_only: Joi.boolean().default(false),
  label_id: idSchema.optional(),
  group_id: idSchema.optional(),
  request_contact: Joi.string().uuid(),
});
export const prepareParams = Joi.object({
  ...workspace,
  mediaType: Joi.string().valid('image', 'video', 'audio', 'document').default('image'),
});
export const prepareQuery = Joi.object({});

export const unreadQuery = Joi.object({
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
});
