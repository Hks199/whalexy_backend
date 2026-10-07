import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { sendLegacyChatMessage } from './services/legacy-chat-message.service.js';
export const text: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyChatMessage(serviceContext(req, res), 'text'));
};
export const location: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyChatMessage(serviceContext(req, res), 'location'));
};
export const reaction: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyChatMessage(serviceContext(req, res), 'reaction'));
};
