import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listMetaFlows as listMetaFlowsService,
  createMetaFlow as createMetaFlowService,
  getMetaFlow as getMetaFlowService,
  updateMetaFlow as updateMetaFlowService,
  changeMetaFlowState as changeMetaFlowStateService,
} from './services/flow-management.service.js';
import {
  updateMetaFlowDefinition as updateMetaFlowDefinitionService,
  previewMetaFlow as previewMetaFlowService,
  getMetaFlowDefinition as getMetaFlowDefinitionService,
} from './services/flow-definitions.service.js';

export const listMetaFlows: RequestHandler = async (req, res) => {
  sendResult(res, await listMetaFlowsService(serviceContext(req, res)));
};
export const createMetaFlow: RequestHandler = async (req, res) => {
  sendResult(res, await createMetaFlowService(serviceContext(req, res)));
};
export const getMetaFlow: RequestHandler = async (req, res) => {
  sendResult(res, await getMetaFlowService(serviceContext(req, res)));
};
export const updateMetaFlow: RequestHandler = async (req, res) => {
  sendResult(res, await updateMetaFlowService(serviceContext(req, res)));
};
export const updateMetaFlowDefinition: RequestHandler = async (req, res) => {
  sendResult(res, await updateMetaFlowDefinitionService(serviceContext(req, res)));
};
export const changeMetaFlowState =
  (action: 'delete' | 'deprecate' | 'publish'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await changeMetaFlowStateService(serviceContext(req, res), action));
  };
export const previewMetaFlow: RequestHandler = async (req, res) => {
  sendResult(res, await previewMetaFlowService(serviceContext(req, res)));
};
export const getMetaFlowDefinition: RequestHandler = async (req, res) => {
  sendResult(res, await getMetaFlowDefinitionService(serviceContext(req, res)));
};
