import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-conversation.service.js';
import { resolveLegacyConversation } from './services/legacy-resolution.service.js';
export const resolve: RequestHandler = async (req, res) => {
  sendResult(res, await resolveLegacyConversation(serviceContext(req, res)));
};
export const reopen: RequestHandler = async (req, res) => {
  sendResult(res, await services.reopen(serviceContext(req, res)));
};
export const accept: RequestHandler = async (req, res) => {
  sendResult(res, await services.accept(serviceContext(req, res)));
};
