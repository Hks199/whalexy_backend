import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  createCheckoutSessionBodySchema,
  createBillingPortalSessionBodySchema,
  listBillingInvoicesQuerySchema,
} from './billing-checkout.validation.js';
import * as controllers from './billing-checkout.controller.js';

export const checkoutRouter = Router({ mergeParams: true });
checkoutRouter.get('/plans', permit('administrative'), controllers.listBillingPlans);
checkoutRouter.post(
  '/checkout',
  permit('administrative'),
  validate(createCheckoutSessionBodySchema),
  controllers.createCheckoutSession,
);
checkoutRouter.post(
  '/portal',
  permit('administrative'),
  validate(createBillingPortalSessionBodySchema),
  controllers.createBillingPortalSession,
);
checkoutRouter.get(
  '/invoices',
  permit('administrative'),
  validate(listBillingInvoicesQuerySchema, 'query'),
  controllers.listBillingInvoices,
);
