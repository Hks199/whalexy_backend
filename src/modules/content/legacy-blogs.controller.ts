import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-blogs.service.js';
export const list: RequestHandler = async (req, res) =>
  sendResult(res, await services.list(serviceContext(req, res)));
export const editor =
  (mode: 'create' | 'edit' | 'preview'): RequestHandler =>
  async (req, res) =>
    sendResult(res, await services.editor(serviceContext(req, res), mode));
export const mutate =
  (
    action: 'create' | 'update' | 'delete' | 'duplicate' | 'publish' | 'unpublish',
  ): RequestHandler =>
  async (req, res) =>
    sendResult(res, await services.mutate(serviceContext(req, res), action));
