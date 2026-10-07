import Joi from 'joi';
import { kind, tags } from './classifications.validation.js';
export const legacyClassificationUpdateSchema = Joi.object({
  contact_uid: Joi.string().uuid().required(),
  attribute: kind,
  value: Joi.string().trim().min(1).max(100).required(),
});
export const legacyClassificationTagSchema = tags;
export const legacyClassificationContactSchema = Joi.object({
  contactUid: Joi.string().uuid().required(),
});
