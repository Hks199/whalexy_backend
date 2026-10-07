import Joi from 'joi';
import { IANAZone } from 'luxon';
import { pageSchema } from '../../validation/common.js';

export const priorities: Record<string, number> = {
  welcome: 1,
  is: 2,
  starts_with: 3,
  ends_with: 4,
  contains_word: 5,
  contains: 6,
  stop_promotional: 7,
  start_promotional: 8,
  start_ai_bot: 9,
  stop_ai_bot: 10,
  new_message: 11,
};
export const types = Object.keys(priorities);
export const phone = Joi.string().pattern(/^\d{5,100}$/);
export const ruleSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  replyText: Joi.string().max(4096).allow('').required(),
  triggerType: Joi.string()
    .valid(...types)
    .required(),
  replyTrigger: Joi.when('triggerType', {
    is: Joi.valid('welcome', 'new_message'),
    then: Joi.string().max(2000).allow('', null).default(null),
    otherwise: Joi.string().trim().min(1).max(2000).required(),
  }),
  enabled: Joi.boolean().required(),
  phoneNumberId: phone.allow(null).default(null),
}).custom((value, helpers) => {
  const triggers = (value.replyTrigger ?? '')
    .split(',')
    .map((t: string) => t.trim())
    .filter(Boolean);
  if (
    !['welcome', 'new_message'].includes(value.triggerType) &&
    (!triggers.length || triggers.length > 20 || triggers.some((t: string) => t.length > 100))
  )
    return helpers.error('any.invalid');
  return value;
});
export const listBotRepliesQuerySchema = pageSchema;
export const createBotReplyBodySchema = ruleSchema;
export const updateBotReplyBodySchema = ruleSchema;
export const updateBotTimingBodySchema = Joi.object({
  enabled: Joi.boolean().required(),
  timezone: Joi.string()
    .max(100)
    .custom((v, h) => (IANAZone.isValidZone(v) ? v : h.error('any.invalid')))
    .required(),
  startsAt: Joi.string()
    .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .required(),
  endsAt: Joi.string()
    .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .required(),
  triggerTypes: Joi.array()
    .items(Joi.string().valid(...types))
    .unique()
    .max(types.length)
    .required(),
});
