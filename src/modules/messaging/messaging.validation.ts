import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
import { mediaMessageSchema } from './services/media-message.js';
import { interactiveMessageSchema } from './services/interactive-message.js';
import { reactionSchema } from './services/reactions.js';

export const messageSchema = Joi.object({
  contactId: idSchema,
  phoneNumberId: Joi.string()
    .pattern(/^\d{5,100}$/)
    .required(),
  kind: Joi.string()
    .valid('text', 'template', 'location', 'media', 'flow', 'catalog', 'interactive', 'reaction')
    .required(),
  replyToWamid: Joi.when('kind', {
    is: Joi.valid('text', 'media'),
    then: Joi.string()
      .min(1)
      .max(200)
      .pattern(/^[^\x00-\x20\x7f]+$/),
    otherwise: Joi.forbidden(),
  }),
  reaction: Joi.when('kind', {
    is: 'reaction',
    then: reactionSchema.required(),
    otherwise: Joi.forbidden(),
  }),
  interactive: Joi.when('kind', {
    is: 'interactive',
    then: interactiveMessageSchema.required(),
    otherwise: Joi.forbidden(),
  }),
  catalog: Joi.when('kind', {
    is: 'catalog',
    then: Joi.object({
      catalogId: idSchema,
      mode: Joi.string().valid('single', 'multiple', 'catalog').required(),
      productIds: Joi.array().items(idSchema.optional()).unique().max(30).default([]),
      body: Joi.string().trim().max(1024).allow('').default(''),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
  flow: Joi.when('kind', {
    is: 'flow',
    then: Joi.object({
      id: Joi.string()
        .pattern(/^\d{5,100}$/)
        .required(),
      body: Joi.string().trim().min(1).max(1024).required(),
      cta: Joi.string().trim().min(1).max(30).default('Open Flow'),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
  media: Joi.when('kind', {
    is: 'media',
    then: mediaMessageSchema.required(),
    otherwise: Joi.forbidden(),
  }),
  text: Joi.when('kind', {
    is: 'text',
    then: Joi.string().min(1).max(4096).required(),
    otherwise: Joi.forbidden(),
  }),
  templateId: Joi.when('kind', { is: 'template', then: idSchema, otherwise: Joi.forbidden() }),
  components: Joi.when('kind', {
    is: 'template',
    then: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().valid('header', 'body', 'button').required(),
          sub_type: Joi.string().valid('quick_reply', 'url'),
          index: Joi.string().pattern(/^\d{1,2}$/),
          parameters: Joi.array()
            .items(
              Joi.object({
                type: Joi.string().valid('text').required(),
                text: Joi.string().max(1024).required(),
              }),
            )
            .max(20),
        }),
      )
      .max(10)
      .default([]),
    otherwise: Joi.forbidden(),
  }),
  location: Joi.when('kind', {
    is: 'location',
    then: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      name: Joi.string().max(100),
      address: Joi.string().max(500),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
});
export const sendMessageBodySchema = messageSchema;
