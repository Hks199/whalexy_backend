import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { connectSocialAccount as connectSocialAccountService } from './social-accounts.service.js';

export const connectSocialAccount: RequestHandler = async (req, res) => {
  sendResult(res, await connectSocialAccountService(serviceContext(req, res)));
};
