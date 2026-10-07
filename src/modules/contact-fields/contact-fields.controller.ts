import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listContactFields as listContactFieldsService,
  getContactField as getContactFieldService,
  createContactField as createContactFieldService,
  updateContactField as updateContactFieldService,
  deleteContactField as deleteContactFieldService,
} from './contact-fields.service.js';

export const listContactFields: RequestHandler = async (req, res) => {
  sendResult(res, await listContactFieldsService(serviceContext(req, res)));
};
export const getContactField: RequestHandler = async (req, res) => {
  sendResult(res, await getContactFieldService(serviceContext(req, res)));
};
export const createContactField: RequestHandler = async (req, res) => {
  sendResult(res, await createContactFieldService(serviceContext(req, res)));
};
export const updateContactField: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactFieldService(serviceContext(req, res)));
};
export const deleteContactField: RequestHandler = async (req, res) => {
  sendResult(res, await deleteContactFieldService(serviceContext(req, res)));
};
