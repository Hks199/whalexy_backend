import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { validate } from '../../middleware/validation.js';
import * as schema from './whatsapp-orders.validation.js';
import * as controllers from './whatsapp-orders.controller.js';
export const legacyWhatsappOrdersRouter = Router();
legacyWhatsappOrdersRouter.use(authenticateLegacyWorkspace);
legacyWhatsappOrdersRouter.get('/', validate(schema.query, 'query'), controllers.list);
legacyWhatsappOrdersRouter.get('/data', validate(schema.query, 'query'), controllers.list);
legacyWhatsappOrdersRouter.get(
  '/statistics',
  validate(schema.empty, 'query'),
  controllers.statistics,
);
legacyWhatsappOrdersRouter.get(
  '/export',
  validate(schema.exportQuery, 'query'),
  controllers.exportOrders,
);
legacyWhatsappOrdersRouter.patch(
  '/:orderUid/status',
  validate(schema.params, 'params'),
  validate(schema.empty, 'query'),
  validate(schema.updateBody),
  controllers.updateStatus,
);
legacyWhatsappOrdersRouter.get(
  '/:orderUid',
  validate(schema.params, 'params'),
  validate(schema.empty, 'query'),
  controllers.detail,
);
