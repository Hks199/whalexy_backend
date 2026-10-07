import type { RequestHandler } from 'express';
import { sendResult, serviceContext } from '../../http/service-adapter.js';
import * as service from './services/legacy-contact.service.js';

export const createLegacyContact: RequestHandler = async (req, res) => {
  sendResult(res, await service.createLegacyContact(serviceContext(req, res)));
};
export const updateLegacyContact: RequestHandler = async (req, res) => {
  sendResult(res, await service.updateLegacyContact(serviceContext(req, res)));
};
