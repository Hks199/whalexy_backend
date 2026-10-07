import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './knowledge.service.js';

export const uploadKnowledgeDocument: RequestHandler = async (req, res) => {
  sendResult(res, await services.uploadKnowledgeDocument(serviceContext(req, res)));
};
export const addKnowledgeWebsite: RequestHandler = async (req, res) => {
  sendResult(res, await services.addKnowledgeWebsite(serviceContext(req, res)));
};
export const listKnowledgeDocuments: RequestHandler = async (req, res) => {
  sendResult(res, await services.listKnowledgeDocuments(serviceContext(req, res)));
};
export const deleteKnowledgeDocument: RequestHandler = async (req, res) => {
  sendResult(res, await services.deleteKnowledgeDocument(serviceContext(req, res)));
};
