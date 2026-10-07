import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { acceptContactHandoff as acceptContactHandoffService } from './services/accept-contact-handoff.service.js';
export const acceptContactHandoff: RequestHandler = async (req, res) => {
  sendResult(res, await acceptContactHandoffService(serviceContext(req, res)));
};
import {
  listHandoffs as listHandoffsService,
  transferHandoff as transferHandoffService,
  resolveHandoff as resolveHandoffService,
} from './handoffs.service.js';

export const listHandoffs: RequestHandler = async (req, res) => {
  sendResult(res, await listHandoffsService(serviceContext(req, res)));
};
export const transferHandoff: RequestHandler = async (req, res) => {
  sendResult(res, await transferHandoffService(serviceContext(req, res)));
};
export const resolveHandoff: RequestHandler = async (req, res) => {
  sendResult(res, await resolveHandoffService(serviceContext(req, res)));
};
