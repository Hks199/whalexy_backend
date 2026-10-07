import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listContacts as listContactsService,
  createContact as createContactService,
  getContact as getContactService,
  updateContact as updateContactService,
  assignContact as assignContactService,
  resolveContactConversation as resolveContactConversationService,
  updateContactAiSettings as updateContactAiSettingsService,
  updateContactMarketingConsent as updateContactMarketingConsentService,
  listContactMessages as listContactMessagesService,
  addContactToGroups as addContactToGroupsService,
} from './contacts.service.js';

export const listContacts: RequestHandler = async (req, res) => {
  sendResult(res, await listContactsService(serviceContext(req, res)));
};
export const createContact: RequestHandler = async (req, res) => {
  sendResult(res, await createContactService(serviceContext(req, res)));
};
export const getContact: RequestHandler = async (req, res) => {
  sendResult(res, await getContactService(serviceContext(req, res)));
};
export const updateContact: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactService(serviceContext(req, res)));
};
export const assignContact: RequestHandler = async (req, res) => {
  sendResult(res, await assignContactService(serviceContext(req, res)));
};
export const resolveContactConversation: RequestHandler = async (req, res) => {
  sendResult(res, await resolveContactConversationService(serviceContext(req, res)));
};
export const updateContactAiSettings: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactAiSettingsService(serviceContext(req, res)));
};
export const updateContactMarketingConsent: RequestHandler = async (req, res) => {
  sendResult(res, await updateContactMarketingConsentService(serviceContext(req, res)));
};
export const listContactMessages: RequestHandler = async (req, res) => {
  sendResult(res, await listContactMessagesService(serviceContext(req, res)));
};
export const addContactToGroups: RequestHandler = async (req, res) => {
  sendResult(res, await addContactToGroupsService(serviceContext(req, res)));
};
