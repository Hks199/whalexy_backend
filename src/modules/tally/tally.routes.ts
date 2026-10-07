import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  ingestTallyInvoiceBodySchema,
  getTallyInvoiceStatusParamsSchema,
} from './tally.validation.js';
import * as controllers from './tally.controller.js';

export const tallyRouter = Router({ mergeParams: true });
tallyRouter.use(permit('vendor.integrations.manage'));
tallyRouter.get('/ping', controllers.checkTallyConnection);
tallyRouter.post(
  '/invoices',
  permit('vendor.chats.reply'),
  validate(ingestTallyInvoiceBodySchema),
  controllers.ingestTallyInvoice,
);
tallyRouter.get(
  '/invoices/:sourceId',
  validate(getTallyInvoiceStatusParamsSchema, 'params'),
  controllers.getTallyInvoiceStatus,
);
