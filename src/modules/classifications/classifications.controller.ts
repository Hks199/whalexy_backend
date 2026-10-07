import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listClassificationPresets as listClassificationPresetsService,
  getContactClassification as getContactClassificationService,
  updateContactClassification as updateContactClassificationService,
  createClassificationTag as createClassificationTagService,
  deleteClassificationTag as deleteClassificationTagService,
} from './classifications.service.js';

export const listClassificationPresets: RequestHandler = async (req, res) => {
  sendResult(res, await listClassificationPresetsService(serviceContext(req, res)));
};
export const getContactClassification: RequestHandler = async (req, res) => {
  sendResult(res, await getContactClassificationService(serviceContext(req, res)));
};
export const updateContactClassification: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactClassificationService(serviceContext(req, res)));
};
export const createClassificationTag: RequestHandler = async (req, res) => {
  sendResult(res, await createClassificationTagService(serviceContext(req, res)));
};
export const deleteClassificationTag: RequestHandler = async (req, res) => {
  sendResult(res, await deleteClassificationTagService(serviceContext(req, res)));
};
