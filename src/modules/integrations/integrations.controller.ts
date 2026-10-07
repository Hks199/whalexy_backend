import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listIntegrations as listIntegrationsService,
  connectMetaIntegration as connectMetaIntegrationService,
  disconnectIntegration as disconnectIntegrationService,
  connectStoreIntegration as connectStoreIntegrationService,
  syncMessageTemplates as syncMessageTemplatesService,
} from './integrations.service.js';

export const listIntegrations: RequestHandler = async (req, res) => {
  sendResult(res, await listIntegrationsService(serviceContext(req, res)));
};
export const connectMetaIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await connectMetaIntegrationService(serviceContext(req, res)));
};
export const disconnectIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await disconnectIntegrationService(serviceContext(req, res)));
};
export const connectStoreIntegration: RequestHandler = async (req, res) => {
  sendResult(res, await connectStoreIntegrationService(serviceContext(req, res)));
};
export const syncMessageTemplates: RequestHandler = async (req, res) => {
  sendResult(res, await syncMessageTemplatesService(serviceContext(req, res)));
};
