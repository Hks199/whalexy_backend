import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getContactNotes as getContactNotesService,
  updateContactNotes as updateContactNotesService,
  getContactLabels as getContactLabelsService,
  updateContactLabels as updateContactLabelsService,
  getContactCustomValues as getContactCustomValuesService,
  updateContactCustomValues as updateContactCustomValuesService,
} from './services/contact-profile.service.js';
import {
  deleteContact as deleteContactService,
  removeContactFromGroup as removeContactFromGroupService,
  assignContact as assignContactService,
  mergeContacts as mergeContactsService,
  archiveContact as archiveContactService,
} from './services/contact-lifecycle.service.js';
import { importContacts as importContactsService } from './services/contact-import.service.js';
import { prepareContactExport as prepareContactExportService } from './services/contact-export.service.js';

export const getContactNotes: RequestHandler = async (req, res) => {
  sendResult(res, await getContactNotesService(serviceContext(req, res)));
};
export const updateContactNotes: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactNotesService(serviceContext(req, res)));
};
export const deleteContact: RequestHandler = async (req, res) => {
  sendResult(res, await deleteContactService(serviceContext(req, res)));
};
export const getContactLabels: RequestHandler = async (req, res) => {
  sendResult(res, await getContactLabelsService(serviceContext(req, res)));
};
export const updateContactLabels: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactLabelsService(serviceContext(req, res)));
};
export const getContactCustomValues: RequestHandler = async (req, res) => {
  sendResult(res, await getContactCustomValuesService(serviceContext(req, res)));
};
export const updateContactCustomValues: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactCustomValuesService(serviceContext(req, res)));
};
export const removeContactFromGroup: RequestHandler = async (req, res) => {
  sendResult(res, await removeContactFromGroupService(serviceContext(req, res)));
};
export const assignContact: RequestHandler = async (req, res) => {
  sendResult(res, await assignContactService(serviceContext(req, res)));
};
export const mergeContacts: RequestHandler = async (req, res) => {
  sendResult(res, await mergeContactsService(serviceContext(req, res)));
};
export const archiveContact: RequestHandler = async (req, res) => {
  sendResult(res, await archiveContactService(serviceContext(req, res)));
};
export const importContacts: RequestHandler = async (req, res) => {
  sendResult(res, await importContactsService(serviceContext(req, res)));
};
export const exportContacts: RequestHandler = async (req, res) => {
  const rows = await prepareContactExportService(serviceContext(req, res));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
  try {
    while (!res.destroyed) {
      const { value, done } = await rows.next();
      if (done || res.destroyed) break;
      if (!res.write(value))
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
    }
  } finally {
    await rows.return(undefined);
  }
  res.end();
};
