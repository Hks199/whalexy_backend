import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getPublicHome as getPublicHomeService,
  getPublicPolicy as getPublicPolicyService,
} from './home.service.js';

export const getPublicHome: RequestHandler = async (req, res) => {
  sendResult(res, await getPublicHomeService(serviceContext(req, res)));
};
export const getPublicPolicy: RequestHandler = async (req, res) => {
  sendResult(res, await getPublicPolicyService(serviceContext(req, res)));
};
