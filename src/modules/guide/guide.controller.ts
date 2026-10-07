import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { getWorkspaceGuide as getWorkspaceGuideService } from './guide.service.js';

export const getWorkspaceGuide: RequestHandler = async (req, res) => {
  sendResult(res, await getWorkspaceGuideService(serviceContext(req, res)));
};
