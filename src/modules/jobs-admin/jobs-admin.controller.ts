import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { listJobs as listJobsService, retryJob as retryJobService } from './jobs-admin.service.js';

export const listJobs =
  (central: boolean): RequestHandler =>
  async (req, res) => {
    sendResult(res, await listJobsService(serviceContext(req, res), central));
  };
export const retryJob =
  (central: boolean): RequestHandler =>
  async (req, res) => {
    sendResult(res, await retryJobService(serviceContext(req, res), central));
  };
