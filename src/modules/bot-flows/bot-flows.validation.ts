import Joi from 'joi';
import { pageSchema } from '../../validation/common.js';

export const definition = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  enabled: Joi.boolean().required(),
  triggerType: Joi.string()
    .valid('is', 'starts_with', 'ends_with', 'contains_word', 'contains', 'welcome', 'new_message')
    .required(),
  startTrigger: Joi.string().trim().max(2000).allow('').required(),
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  graph: Joi.object().required(),
}).custom((v, h) =>
  !['welcome', 'new_message'].includes(v.triggerType) &&
  (!v.startTrigger ||
    v.startTrigger.split(',').length > 20 ||
    v.startTrigger.split(',').some((t: string) => !t.trim() || t.trim().length > 100))
    ? h.error('any.invalid')
    : v,
);
export const listBotFlowsQuerySchema = pageSchema;
export const createBotFlowBodySchema = definition;
export const updateBotFlowBodySchema = definition;
export const cloneBotFlowBodySchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
});
export const previewBotFlowBodySchema = Joi.object({
  inputs: Joi.array()
    .items(
      Joi.object({
        text: Joi.string().max(4096),
        selection: Joi.string().max(100),
        selectionNodeId: Joi.string().pattern(/^[A-Za-z0-9_-]{1,100}$/),
      })
        .or('text', 'selection')
        .with('selectionNodeId', 'selection'),
    )
    .max(20)
    .default([]),
});
