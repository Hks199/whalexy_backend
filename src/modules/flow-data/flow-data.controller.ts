import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  registerFlowEncryptionKey as registerFlowEncryptionKeyService,
  getFlowEncryptionKey as getFlowEncryptionKeyService,
} from './services/flow-encryption-keys.service.js';
import {
  configureFlowDataEndpoint as configureFlowDataEndpointService,
  getFlowDataEndpoint as getFlowDataEndpointService,
} from './services/flow-endpoint-settings.service.js';
import { handleEncryptedFlowRequest as handleEncryptedFlowRequestService } from './services/flow-data-exchange.service.js';

export const registerFlowEncryptionKey: RequestHandler = async (req, res) => {
  sendResult(res, await registerFlowEncryptionKeyService(serviceContext(req, res)));
};
export const getFlowEncryptionKey: RequestHandler = async (req, res) => {
  sendResult(res, await getFlowEncryptionKeyService(serviceContext(req, res)));
};
export const configureFlowDataEndpoint: RequestHandler = async (req, res) => {
  sendResult(res, await configureFlowDataEndpointService(serviceContext(req, res)));
};
export const getFlowDataEndpoint: RequestHandler = async (req, res) => {
  sendResult(res, await getFlowDataEndpointService(serviceContext(req, res)));
};
export const handleEncryptedFlowRequest: RequestHandler = async (req, res) => {
  sendResult(res, await handleEncryptedFlowRequestService(serviceContext(req, res)));
};
