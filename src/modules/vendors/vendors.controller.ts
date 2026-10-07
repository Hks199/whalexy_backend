import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listProjects as listProjectsService,
  createProject as createProjectService,
  selectProject as selectProjectService,
  listTeamMembers as listTeamMembersService,
  inviteTeamMember as inviteTeamMemberService,
  updateTeamMember as updateTeamMemberService,
  createApiKey as createApiKeyService,
  revokeApiKey as revokeApiKeyService,
} from './vendors.service.js';

export const listProjects: RequestHandler = async (req, res) => {
  sendResult(res, await listProjectsService(serviceContext(req, res)));
};
export const createProject: RequestHandler = async (req, res) => {
  sendResult(res, await createProjectService(serviceContext(req, res)));
};
export const selectProject: RequestHandler = async (req, res) => {
  sendResult(res, await selectProjectService(serviceContext(req, res)));
};
export const listTeamMembers: RequestHandler = async (req, res) => {
  sendResult(res, await listTeamMembersService(serviceContext(req, res)));
};
export const inviteTeamMember: RequestHandler = async (req, res) => {
  sendResult(res, await inviteTeamMemberService(serviceContext(req, res)));
};
export const updateTeamMember: RequestHandler = async (req, res) => {
  sendResult(res, await updateTeamMemberService(serviceContext(req, res)));
};
export const createApiKey: RequestHandler = async (req, res) => {
  sendResult(res, await createApiKeyService(serviceContext(req, res)));
};
export const revokeApiKey: RequestHandler = async (req, res) => {
  sendResult(res, await revokeApiKeyService(serviceContext(req, res)));
};
