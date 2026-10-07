import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listResourceRecords as listResourceRecordsService,
  getResourceRecord as getResourceRecordService,
  createResourceRecord as createResourceRecordService,
  updateResourceRecord as updateResourceRecordService,
} from './resources.service.js';

export const listResourceRecords: RequestHandler = async (req, res) => {
  sendResult(res, await listResourceRecordsService(serviceContext(req, res)));
};
export const getResourceRecord: RequestHandler = async (req, res) => {
  sendResult(res, await getResourceRecordService(serviceContext(req, res)));
};
export const createResourceRecord: RequestHandler = async (req, res) => {
  sendResult(res, await createResourceRecordService(serviceContext(req, res)));
};
export const updateResourceRecord: RequestHandler = async (req, res) => {
  sendResult(res, await updateResourceRecordService(serviceContext(req, res)));
};
