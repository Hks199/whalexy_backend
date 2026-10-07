import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
export const legacyGroupMembershipBodySchema = Joi.object({
  selected_contacts: Joi.array().items(Joi.string().uuid()).min(1).max(100).unique().required(),
  selected_groups: Joi.array().items(idSchema).min(1).max(50).unique().required(),
});
export const legacyGroupRemovalParamsSchema = Joi.object({
  contactIdOrUid: Joi.alternatives().try(idSchema, Joi.string().uuid()).required(),
  groupUid: Joi.string().uuid().required(),
});
export const legacyGroupRemovalBodySchema = Joi.object({});
