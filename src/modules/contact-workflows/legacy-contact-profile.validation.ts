import Joi from 'joi';
import { ids } from './contact-workflows.validation.js';
export const legacyNotesSchema = Joi.object({
  contactIdOrUid: Joi.string().uuid().required(),
  contact_notes: Joi.string().max(10000).allow('', null).default(''),
});
export const legacyLabelAssignmentSchema = Joi.object({
  contactUid: Joi.string().uuid().required(),
  contact_labels: ids.optional().allow(null).default([]),
});
export const legacyLabelContactSchema = Joi.object({ contactUid: Joi.string().uuid().required() });
export const legacyLabelListSchema = Joi.object({
  page: Joi.number().integer().min(1).max(10000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(100),
});

export const legacyChatAssignmentSchema = Joi.object({
  contactIdOrUid: Joi.string().uuid().required(),
  assigned_users_uid: Joi.alternatives()
    .try(Joi.string().uuid(), Joi.string().valid('no_one', ''))
    .allow(null)
    .default(null),
});
