import Joi from 'joi';
import { idSchema } from '../../validation/common.js';

export const createProjectBodySchema = Joi.object({
  title: Joi.string().trim().min(2).max(160).required(),
});
export const selectProjectParamsSchema = Joi.object({ id: idSchema });
export const inviteTeamMemberBodySchema = Joi.object({
  userId: idSchema,
  permissions: Joi.array()
    .items(Joi.string().pattern(/^[a-z][a-z0-9_.]*$/))
    .max(150)
    .required(),
});
export const updateTeamMemberParamsSchema = Joi.object({ id: Joi.string().uuid().required() });
export const updateTeamMemberBodySchema = Joi.object({
  permissions: Joi.array()
    .items(Joi.string().pattern(/^[a-z][a-z0-9_.]*$/))
    .max(150),
  active: Joi.boolean(),
}).min(1);
export const createApiKeyBodySchema = Joi.object({
  permissions: Joi.array()
    .items(Joi.string().pattern(/^[a-z][a-z0-9_.]*$/))
    .max(100)
    .required(),
  expiresAt: Joi.date().greater('now').required(),
});
