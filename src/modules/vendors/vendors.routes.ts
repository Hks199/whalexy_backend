import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { permit } from '../../middleware/auth.js';
import {
  createProjectBodySchema,
  selectProjectParamsSchema,
  inviteTeamMemberBodySchema,
  updateTeamMemberParamsSchema,
  updateTeamMemberBodySchema,
  createApiKeyBodySchema,
} from './vendors.validation.js';
import * as controllers from './vendors.controller.js';

export const projectsRouter = Router();
export const teamRouter = Router({ mergeParams: true });
projectsRouter.get('/', controllers.listProjects);
projectsRouter.post('/', validate(createProjectBodySchema), controllers.createProject);
projectsRouter.post(
  '/:id/select',
  validate(selectProjectParamsSchema, 'params'),
  controllers.selectProject,
);
teamRouter.get('/', permit('vendor.team.view'), controllers.listTeamMembers);
teamRouter.post(
  '/',
  permit('vendor.team.create'),
  validate(inviteTeamMemberBodySchema),
  controllers.inviteTeamMember,
);
teamRouter.patch(
  '/:id',
  permit('vendor.team.edit'),
  validate(updateTeamMemberParamsSchema, 'params'),
  validate(updateTeamMemberBodySchema),
  controllers.updateTeamMember,
);
teamRouter.post(
  '/api-keys',
  permit('vendor.settings.manage'),
  validate(createApiKeyBodySchema),
  controllers.createApiKey,
);
teamRouter.delete('/api-keys/:id', permit('vendor.settings.manage'), controllers.revokeApiKey);
