import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  startMetaSignup as startMetaSignupService,
  completeMetaSignup as completeMetaSignupService,
} from './meta-signup.service.js';

export const startMetaSignup: RequestHandler = async (req, res) => {
  sendResult(res, await startMetaSignupService(serviceContext(req, res)));
};
export const completeMetaSignup: RequestHandler = async (req, res) => {
  sendResult(res, await completeMetaSignupService(serviceContext(req, res)));
};
