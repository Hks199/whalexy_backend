import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';
import { mediaUrlSchema } from '../messaging/services/media-message.js';

export const text = Joi.string()
  .trim()
  .min(1)
  .max(1000)
  .pattern(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/);
export const identifier = Joi.string().pattern(/^[A-Za-z0-9_-]{1,200}$/);
export const ruleSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  platform: Joi.string().valid('facebook', 'instagram').required(),
  externalAccountId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  status: Joi.string().valid('draft', 'active', 'paused').default('draft'),
  contentScope: Joi.string().valid('all', 'specific').default('all'),
  mediaId: Joi.when('contentScope', {
    is: 'specific',
    then: identifier.required(),
    otherwise: Joi.forbidden(),
  }),
  commentMatchType: Joi.string().valid('any', 'keyword').default('any'),
  matchOperator: Joi.string().valid('contains', 'equals', 'starts_with').default('contains'),
  keywords: Joi.when('commentMatchType', {
    is: 'keyword',
    then: Joi.array().items(Joi.string().trim().min(1).max(100)).min(1).max(50).required(),
    otherwise: Joi.array().max(0).default([]),
  }),
  dmMessage: text.required(),
  publicReplyEnabled: Joi.boolean().default(false),
  publicReplyMessage: Joi.when('publicReplyEnabled', {
    is: true,
    then: text.required(),
    otherwise: Joi.forbidden(),
  }),
  attachment: Joi.object({
    type: Joi.string().valid('image', 'video', 'audio', 'file').required(),
    url: mediaUrlSchema.required(),
  }),
  followGateEnabled: Joi.boolean().default(false),
  followGateMessage: Joi.when('followGateEnabled', {
    is: true,
    then: text.required(),
    otherwise: Joi.forbidden(),
  }),
  followGateRetryMessage: Joi.when('followGateEnabled', {
    is: true,
    then: text.default('Follow the account, then tap the button again.'),
    otherwise: Joi.forbidden(),
  }),
});
export const listCommentAutomationsQuerySchema = pageSchema;
export const listAutomationExecutionsQuerySchema = pageSchema;
export const createCommentAutomationBodySchema = ruleSchema;
export const useIdParamsSchema = Joi.object({ vendorId: idSchema, id: idSchema });
export const updateCommentAutomationBodySchema = ruleSchema;
