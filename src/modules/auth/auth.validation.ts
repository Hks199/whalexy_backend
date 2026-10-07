import Joi from 'joi';
import { phoneSchema } from '../../validation/common.js';

export const password = Joi.string().min(12).max(128).required();
export const email = Joi.string().email().lowercase().max(254).required();
export const phoneProof = Joi.object({
  challengeId: Joi.string().uuid().required(),
  emailCode: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
});
export const registerBodySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email,
  password,
  phoneNumber: phoneSchema.required(),
  businessName: Joi.string().trim().min(2).max(160).required(),
});
export const resendVerificationBodySchema = Joi.object({
  email,
  password: Joi.string().min(1).max(128).required(),
});
export const loginBodySchema = Joi.object({
  email,
  password: Joi.string().min(1).max(128).required(),
});
export const refreshSessionBodySchema = Joi.object({
  refreshToken: Joi.string().min(40).max(128).required(),
});
export const verifyEmailBodySchema = Joi.object({
  challengeId: Joi.string().uuid().required(),
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
});
export const requestPasswordResetBodySchema = Joi.object({ email });
export const startPhoneVerificationBodySchema = phoneProof;
export const verifyPhoneBodySchema = phoneProof.keys({
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required(),
});
export const resetPasswordBodySchema = Joi.object({
  challengeId: Joi.string().uuid().required(),
  token: Joi.string().min(40).max(128).required(),
  password,
});
