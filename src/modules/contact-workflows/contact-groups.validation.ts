import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { dataTableQuerySchema } from '../../validation/data-table.js';
const identifier = Joi.alternatives().try(idSchema, Joi.string().uuid()).required();
const title = Joi.string().trim().max(200).required();
const description = Joi.string().max(4000).allow('', null);
export const createContactGroupSchema = Joi.object({
  title,
  description,
  status: Joi.number().integer().valid(1, 5),
  wabPhoneNumberId: Joi.string().max(100).allow(null),
});
export const updateContactGroupSchema = createContactGroupSchema
  .fork('title', (s) => s.optional())
  .min(1);
export const legacyGroupCreateSchema = Joi.object({
  title,
  description: description.default(null),
});
export const legacyGroupUpdateSchema = legacyGroupCreateSchema.keys({
  contactGroupIdOrUid: identifier,
});
export const legacyGroupParamsSchema = Joi.object({ contactGroupIdOrUid: identifier });
export const legacyGroupStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'archived'),
});
export const legacyGroupListSchema = dataTableQuerySchema([2, 3]);
export const legacyGroupBatchSchema = Joi.object({
  selected_groups: Joi.array().items(Joi.string().uuid()).unique().min(1).max(100).required(),
});
export const legacyGroupEmptySchema = Joi.object({}).default({});

export const legacyGroupMergeSchema = Joi.object({
  source_group_uid: Joi.string().uuid().required(),
  target_group_uid: Joi.string().uuid().invalid(Joi.ref('source_group_uid')).required(),
});

export const legacyGroupAssignmentSchema = Joi.object({
  group_uid: Joi.string().uuid().required(),
  agent_uid: Joi.string().uuid().required(),
});
