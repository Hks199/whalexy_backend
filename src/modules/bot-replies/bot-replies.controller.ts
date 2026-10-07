import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listBotReplies as listBotRepliesService,
  createBotReply as createBotReplyService,
  updateBotReply as updateBotReplyService,
  deleteBotReply as deleteBotReplyService,
  updateBotTiming as updateBotTimingService,
} from './services/reply-management.service.js';

export const listBotReplies: RequestHandler = async (req, res) => {
  sendResult(res, await listBotRepliesService(serviceContext(req, res)));
};
export const createBotReply: RequestHandler = async (req, res) => {
  sendResult(res, await createBotReplyService(serviceContext(req, res)));
};
export const updateBotReply: RequestHandler = async (req, res) => {
  sendResult(res, await updateBotReplyService(serviceContext(req, res)));
};
export const deleteBotReply: RequestHandler = async (req, res) => {
  sendResult(res, await deleteBotReplyService(serviceContext(req, res)));
};
export const updateBotTiming: RequestHandler = async (req, res) => {
  sendResult(res, await updateBotTimingService(serviceContext(req, res)));
};
