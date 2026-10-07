import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import { listLegacyContacts } from './services/legacy-contact-list.service.js';
export const listLegacyContactsData: RequestHandler = async (req, res) => {
  sendResult(res, await listLegacyContacts(serviceContext(req, res)));
};
