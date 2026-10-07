import { deleteCampaign as deleteCampaignService } from './services/campaign-deletion.service.js';
import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listCampaigns as listCampaignsService,
  createCampaign as createCampaignService,
  duplicateCampaign as duplicateCampaignService,
} from './services/campaign-management.service.js';
import {
  cancelCampaign as cancelCampaignService,
  pauseCampaign as pauseCampaignService,
  resumeCampaign as resumeCampaignService,
  archiveCampaign as archiveCampaignService,
  restoreCampaign as restoreCampaignService,
} from './services/campaign-lifecycle.service.js';
import {
  getCampaignStatus as getCampaignStatusService,
  getCampaignReport as getCampaignReportService,
  listCampaignRecipients as listCampaignRecipientsService,
} from './services/campaign-reporting.service.js';
import { sendCampaignTest as sendCampaignTestService } from './services/campaign-delivery.service.js';

export const listCampaigns: RequestHandler = async (req, res) => {
  sendResult(res, await listCampaignsService(serviceContext(req, res)));
};
export const createCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await createCampaignService(serviceContext(req, res)));
};
export const cancelCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await cancelCampaignService(serviceContext(req, res)));
};
export const pauseCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await pauseCampaignService(serviceContext(req, res)));
};
export const resumeCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await resumeCampaignService(serviceContext(req, res)));
};
export const duplicateCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await duplicateCampaignService(serviceContext(req, res)));
};
export const getCampaignStatus: RequestHandler = async (req, res) => {
  sendResult(res, await getCampaignStatusService(serviceContext(req, res)));
};
export const sendCampaignTest: RequestHandler = async (req, res) => {
  sendResult(res, await sendCampaignTestService(serviceContext(req, res)));
};
export const archiveCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await archiveCampaignService(serviceContext(req, res)));
};
export const restoreCampaign: RequestHandler = async (req, res) => {
  sendResult(res, await restoreCampaignService(serviceContext(req, res)));
};
export const getCampaignReport: RequestHandler = async (req, res) => {
  sendResult(res, await getCampaignReportService(serviceContext(req, res)));
};
export const listCampaignRecipients: RequestHandler = async (req, res) => {
  sendResult(res, await listCampaignRecipientsService(serviceContext(req, res)));
};

export const deleteCampaign: RequestHandler = async (req, res) =>
  sendResult(res, await deleteCampaignService(serviceContext(req, res)));
