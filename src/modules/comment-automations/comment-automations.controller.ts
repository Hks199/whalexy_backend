import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listCommentAutomations as listCommentAutomationsService,
  listAutomationExecutions as listAutomationExecutionsService,
  createCommentAutomation as createCommentAutomationService,
  getCommentAutomation as getCommentAutomationService,
  updateCommentAutomation as updateCommentAutomationService,
  deleteCommentAutomation as deleteCommentAutomationService,
} from './services/automation-management.service.js';

export const listCommentAutomations: RequestHandler = async (req, res) => {
  sendResult(res, await listCommentAutomationsService(serviceContext(req, res)));
};
export const listAutomationExecutions: RequestHandler = async (req, res) => {
  sendResult(res, await listAutomationExecutionsService(serviceContext(req, res)));
};
export const createCommentAutomation: RequestHandler = async (req, res) => {
  sendResult(res, await createCommentAutomationService(serviceContext(req, res)));
};
export const getCommentAutomation: RequestHandler = async (req, res) => {
  sendResult(res, await getCommentAutomationService(serviceContext(req, res)));
};
export const updateCommentAutomation: RequestHandler = async (req, res) => {
  sendResult(res, await updateCommentAutomationService(serviceContext(req, res)));
};
export const deleteCommentAutomation: RequestHandler = async (req, res) => {
  sendResult(res, await deleteCommentAutomationService(serviceContext(req, res)));
};
