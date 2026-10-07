import * as middleware from './manual-billing.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listManualSubscriptionsQuerySchema,
  quoteManualSubscriptionBodySchema,
  useManualIdParamsSchema,
  submitManualPaymentBodySchema,
  cancelManualPaymentBodySchema,
} from './manual-billing.validation.js';
import * as controllers from './manual-billing.controller.js';

export const manualBillingRouter = Router({ mergeParams: true });
manualBillingRouter.use('/manual', permit('administrative'), middleware.requireBusinessOwner);
manualBillingRouter.get(
  '/manual',
  validate(listManualSubscriptionsQuerySchema, 'query'),
  controllers.listManualSubscriptions,
);
manualBillingRouter.post(
  '/manual/quote',
  validate(quoteManualSubscriptionBodySchema),
  controllers.quoteManualSubscription,
);
manualBillingRouter.use('/manual/:id', validate(useManualIdParamsSchema, 'params'));
manualBillingRouter.get('/manual/:id', controllers.getManualSubscription);
manualBillingRouter.post(
  '/manual/:id/submit',
  validate(submitManualPaymentBodySchema),
  controllers.submitManualPayment,
);
manualBillingRouter.post(
  '/manual/:id/cancel',
  validate(cancelManualPaymentBodySchema),
  controllers.cancelManualPayment,
);
manualBillingRouter.get('/manual/:id/invoice', controllers.getManualInvoice);
manualBillingRouter.get('/manual/:id/invoice.pdf', controllers.downloadManualInvoice);
