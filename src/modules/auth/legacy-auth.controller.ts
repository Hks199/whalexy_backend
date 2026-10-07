import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as service from './services/legacy-auth.service.js';
export const loginLegacyUser: RequestHandler = async (req, res) => {
  sendResult(res, await service.loginLegacyUser(serviceContext(req, res)));
};
export const registerLegacyUser: RequestHandler = async (req, res) => {
  sendResult(res, await service.registerLegacyUser(serviceContext(req, res)));
};
export const prepareLegacyRegistration: RequestHandler = async (req, res) => {
  sendResult(res, await service.prepareLegacyRegistration());
};
export const logoutLegacyUser: RequestHandler = async (req, res) => {
  sendResult(res, await service.logoutLegacyUser(serviceContext(req, res)));
};
export const getLegacyCurrentUser: RequestHandler = async (req, res) => {
  sendResult(res, await service.getLegacyCurrentUser(serviceContext(req, res)));
};
export const getLegacyApiRoot: RequestHandler = (_req, res) => {
  res.type('text/plain').send('api endpoint');
};
