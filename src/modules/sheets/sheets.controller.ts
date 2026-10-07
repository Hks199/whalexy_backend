import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listSheetIntegrations as listSheetIntegrationsService,
  listSheetTemplates as listSheetTemplatesService,
  createSheetIntegration as createSheetIntegrationService,
  getSheetIntegration as getSheetIntegrationService,
  getSheetScript as getSheetScriptService,
  updateSheetStatus as updateSheetStatusService,
  deleteSheetIntegration as deleteSheetIntegrationService,
} from './services/sheet-integrations.service.js';
import { ingestSheetRows as ingestSheetRowsService } from './services/sheet-ingestion.service.js';

export const listSheetIntegrations: RequestHandler = async (req, res) => {
  sendResult(res, await listSheetIntegrationsService(serviceContext(req, res)));
};
export const listSheetTemplates: RequestHandler = async (req, res) => {
  sendResult(res, await listSheetTemplatesService(serviceContext(req, res)));
};
export const createSheetIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await createSheetIntegrationService(serviceContext(req, res)));
};
export const getSheetIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await getSheetIntegrationService(serviceContext(req, res)));
};
export const getSheetScript: RequestHandler = async (req, res) => {
  sendResult(res, await getSheetScriptService(serviceContext(req, res)));
};
export const updateSheetStatus: RequestHandler = async (req, res) => {
  sendResult(res, await updateSheetStatusService(serviceContext(req, res)));
};
export const deleteSheetIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await deleteSheetIntegrationService(serviceContext(req, res)));
};
export const ingestSheetRows: RequestHandler = async (req, res) => {
  sendResult(res, await ingestSheetRowsService(serviceContext(req, res)));
};
