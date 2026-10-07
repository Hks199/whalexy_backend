import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { sendLegacyMessage } from './services/legacy-messaging.service.js';

export const sendLegacyTextMessage: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyMessage(serviceContext(req, res), 'text'));
};
export const sendLegacyMediaMessage: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyMessage(serviceContext(req, res), 'media'));
};
export const sendLegacyTemplateMessage: RequestHandler = async (req, res) => {
  sendResult(res, await sendLegacyMessage(serviceContext(req, res), 'template'));
};
