import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listCustomerExperienceScores as listCustomerExperienceScoresService,
  getCustomerExperienceScore as getCustomerExperienceScoreService,
  retryCustomerExperienceScore as retryCustomerExperienceScoreService,
} from './cx-scores.service.js';

export const listCustomerExperienceScores: RequestHandler = async (req, res) => {
  sendResult(res, await listCustomerExperienceScoresService(serviceContext(req, res)));
};
export const getCustomerExperienceScore: RequestHandler = async (req, res) => {
  sendResult(res, await getCustomerExperienceScoreService(serviceContext(req, res)));
};
export const retryCustomerExperienceScore: RequestHandler = async (req, res) => {
  sendResult(res, await retryCustomerExperienceScoreService(serviceContext(req, res)));
};
