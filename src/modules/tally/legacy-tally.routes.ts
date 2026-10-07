import { Router } from 'express';
import { authenticateLegacyVendor } from '../../middleware/legacy-vendor.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { legacyTallyInvoiceBodySchema } from './legacy-tally.validation.js';
import * as controllers from './legacy-tally.controller.js';
export const legacyTallyRouter = Router({ mergeParams: true });
legacyTallyRouter.use(authenticateLegacyVendor, permit('vendor.integrations.manage'));
legacyTallyRouter.get('/ping', controllers.pingLegacyTally);
legacyTallyRouter.post(
  '/send-invoice',
  permit('vendor.chats.reply'),
  validate(legacyTallyInvoiceBodySchema),
  controllers.sendLegacyTallyInvoice,
);
