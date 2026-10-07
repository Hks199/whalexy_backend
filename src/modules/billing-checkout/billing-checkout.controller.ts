import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listBillingPlans as listBillingPlansService,
  createCheckoutSession as createCheckoutSessionService,
  createBillingPortalSession as createBillingPortalSessionService,
  listBillingInvoices as listBillingInvoicesService,
} from './billing-checkout.service.js';

export const listBillingPlans: RequestHandler = async (req, res) => {
  sendResult(res, await listBillingPlansService(serviceContext(req, res)));
};
export const createCheckoutSession: RequestHandler = async (req, res) => {
  sendResult(res, await createCheckoutSessionService(serviceContext(req, res)));
};
export const createBillingPortalSession: RequestHandler = async (req, res) => {
  sendResult(res, await createBillingPortalSessionService(serviceContext(req, res)));
};
export const listBillingInvoices: RequestHandler = async (req, res) => {
  sendResult(res, await listBillingInvoicesService(serviceContext(req, res)));
};
