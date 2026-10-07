import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listPublicLanguages as listPublicLanguagesService,
  getPublicLanguage as getPublicLanguageService,
  listAdminLanguages as listAdminLanguagesService,
  createLanguage as createLanguageService,
  updateLanguage as updateLanguageService,
  deleteLanguage as deleteLanguageService,
  getLanguageMessages as getLanguageMessagesService,
  updateLanguageMessages as updateLanguageMessagesService,
  importLanguagePo as importLanguagePoService,
  exportLanguagePo as exportLanguagePoService,
} from './translations.service.js';

export const listPublicLanguages: RequestHandler = async (req, res) => {
  sendResult(res, await listPublicLanguagesService(serviceContext(req, res)));
};
export const getPublicLanguage: RequestHandler = async (req, res) => {
  sendResult(res, await getPublicLanguageService(serviceContext(req, res)));
};
export const listAdminLanguages: RequestHandler = async (req, res) => {
  sendResult(res, await listAdminLanguagesService(serviceContext(req, res)));
};
export const createLanguage: RequestHandler = async (req, res) => {
  sendResult(res, await createLanguageService(serviceContext(req, res)));
};
export const updateLanguage: RequestHandler = async (req, res) => {
  sendResult(res, await updateLanguageService(serviceContext(req, res)));
};
export const deleteLanguage: RequestHandler = async (req, res) => {
  sendResult(res, await deleteLanguageService(serviceContext(req, res)));
};
export const getLanguageMessages: RequestHandler = async (req, res) => {
  sendResult(res, await getLanguageMessagesService(serviceContext(req, res)));
};
export const updateLanguageMessages: RequestHandler = async (req, res) => {
  sendResult(res, await updateLanguageMessagesService(serviceContext(req, res)));
};
export const importLanguagePo: RequestHandler = async (req, res) => {
  sendResult(res, await importLanguagePoService(serviceContext(req, res)));
};
export const exportLanguagePo: RequestHandler = async (req, res) => {
  sendResult(res, await exportLanguagePoService(serviceContext(req, res)));
};
