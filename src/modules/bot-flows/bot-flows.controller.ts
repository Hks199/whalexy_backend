import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listBotFlows as listBotFlowsService,
  createBotFlow as createBotFlowService,
  getBotFlow as getBotFlowService,
  updateBotFlow as updateBotFlowService,
  exportBotFlow as exportBotFlowService,
  cloneBotFlow as cloneBotFlowService,
  previewBotFlow as previewBotFlowService,
  deleteBotFlow as deleteBotFlowService,
} from './bot-flows.service.js';

export const listBotFlows: RequestHandler = async (req, res) => {
  sendResult(res, await listBotFlowsService(serviceContext(req, res)));
};
export const createBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await createBotFlowService(serviceContext(req, res)));
};
export const getBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await getBotFlowService(serviceContext(req, res)));
};
export const updateBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await updateBotFlowService(serviceContext(req, res)));
};
export const exportBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await exportBotFlowService(serviceContext(req, res)));
};
export const cloneBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await cloneBotFlowService(serviceContext(req, res)));
};
export const previewBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await previewBotFlowService(serviceContext(req, res)));
};
export const deleteBotFlow: RequestHandler = async (req, res) => {
  sendResult(res, await deleteBotFlowService(serviceContext(req, res)));
};
