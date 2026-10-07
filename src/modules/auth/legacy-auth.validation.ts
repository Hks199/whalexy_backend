import Joi from 'joi';
import { password, email } from './auth.validation.js';
import { phoneSchema } from '../../validation/common.js';

export const legacyLoginBodySchema = Joi.object({
  email: Joi.string().trim().max(254).required(),
  password: Joi.string().min(1).max(128).required(),
  remember: Joi.boolean(),
});
export const legacyRegisterBodySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  first_name: Joi.string().trim().max(50),
  last_name: Joi.string().trim().max(50).allow(''),
  email,
  password,
  password_confirmation: Joi.valid(Joi.ref('password')),
  phone_number: phoneSchema,
  mobile_number: phoneSchema,
  business_name: Joi.string().trim().min(2).max(160).required(),
})
  .oxor('name', 'first_name')
  .or('name', 'first_name')
  .oxor('phone_number', 'mobile_number')
  .or('phone_number', 'mobile_number');
