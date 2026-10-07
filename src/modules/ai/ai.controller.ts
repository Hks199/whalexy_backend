import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  generateAiReply as generateAiReplyService,
  listKnowledgeDocuments as listKnowledgeDocumentsService,
  deleteKnowledgeDocument as deleteKnowledgeDocumentService,
  requestAiSupport as requestAiSupportService,
} from './ai.service.js';

export const generateAiReply: RequestHandler = async (req, res) => {
  sendResult(res, await generateAiReplyService(serviceContext(req, res)));
};
export const listKnowledgeDocuments: RequestHandler = async (req, res) => {
  sendResult(res, await listKnowledgeDocumentsService(serviceContext(req, res)));
};
export const deleteKnowledgeDocument: RequestHandler = async (req, res) => {
  sendResult(res, await deleteKnowledgeDocumentService(serviceContext(req, res)));
};
export const requestAiSupport: RequestHandler = async (req, res) => {
  sendResult(res, await requestAiSupportService(serviceContext(req, res)));
};
