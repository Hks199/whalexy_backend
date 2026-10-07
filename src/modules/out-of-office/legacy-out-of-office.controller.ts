import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { readLegacyAwaySettings } from './services/legacy-out-of-office.service.js';
import { updateAwaySettings } from './out-of-office.service.js';
export const read: RequestHandler = async (req, res) =>
  sendResult(res, await readLegacyAwaySettings(serviceContext(req, res)));
export const write: RequestHandler = async (req, res) =>
  sendResult(res, await updateAwaySettings(serviceContext(req, res), true));
