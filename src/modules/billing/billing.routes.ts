import * as middleware from './billing.middleware.js';
import { Router } from 'express';
import { authenticate, permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { downloadPaymentReceipt } from '../manual-billing/manual-billing.controller.js';
import {
  vendorBillingParamsSchema,
  reviewManualSubscriptionParamsSchema,
  reviewManualSubscriptionBodySchema,
  getManualIdReceiptParamsSchema,
  overrideAiReplyAllowanceBodySchema,
} from './billing.validation.js';
import * as controllers from './billing.controller.js';

export const billingRouter = Router({ mergeParams: true });
export const adminBillingRouter = Router({ mergeParams: true });
adminBillingRouter.use(authenticate, middleware.requireSiteAdministrator);
adminBillingRouter.use(
  validate(vendorBillingParamsSchema, 'params'),
  middleware.requireExistingVendor,
);
for (const action of ['approve', 'reject'] as const) {
  adminBillingRouter.post(
    `/manual/:id/${action}`,
    validate(reviewManualSubscriptionParamsSchema, 'params'),
    validate(reviewManualSubscriptionBodySchema(action)),
    controllers.reviewManualSubscription(action),
  );
}
adminBillingRouter.get(
  '/manual/:id/receipt',
  validate(getManualIdReceiptParamsSchema, 'params'),
  downloadPaymentReceipt,
);
adminBillingRouter.post(
  '/addons/ai-replies/override',
  validate(overrideAiReplyAllowanceBodySchema),
  controllers.overrideAiReplyAllowance,
);
adminBillingRouter.delete('/addons/ai-replies/override', controllers.removeAiReplyOverride);
billingRouter.get('/', permit('administrative'), controllers.getBillingSummary);
