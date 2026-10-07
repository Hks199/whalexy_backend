import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  getContactClassificationParamsSchema,
  getContactClassificationQuerySchema,
  updateContactClassificationParamsSchema,
  updateContactClassificationBodySchema,
  createClassificationTagBodySchema,
  deleteClassificationTagParamsSchema,
} from './classifications.validation.js';
import * as controllers from './classifications.controller.js';

export const classificationsRouter = Router({ mergeParams: true });
classificationsRouter.get(
  '/presets',
  permit('vendor.cx.view'),
  controllers.listClassificationPresets,
);
classificationsRouter.get(
  '/contacts/:id',
  permit('vendor.cx.view'),
  validate(getContactClassificationParamsSchema, 'params'),
  validate(getContactClassificationQuerySchema, 'query'),
  controllers.getContactClassification,
);
classificationsRouter.patch(
  '/contacts/:id',
  permit('vendor.cx.manage'),
  validate(updateContactClassificationParamsSchema, 'params'),
  validate(updateContactClassificationBodySchema),
  controllers.updateContactClassification,
);
classificationsRouter.post(
  '/tags',
  permit('vendor.cx.manage'),
  validate(createClassificationTagBodySchema),
  controllers.createClassificationTag,
);
classificationsRouter.delete(
  '/tags/:id',
  permit('vendor.cx.manage'),
  validate(deleteClassificationTagParamsSchema, 'params'),
  controllers.deleteClassificationTag,
);
