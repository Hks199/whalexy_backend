import * as middleware from './resources.middleware.js';
import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { listResourceRecordsQuerySchema } from './resources.validation.js';
import * as controllers from './resources.controller.js';

export const resourceRouter = Router({ mergeParams: true });
resourceRouter.use('/:resource', middleware.authorizeResourceAccess);
resourceRouter.get(
  '/:resource',
  validate(listResourceRecordsQuerySchema, 'query'),
  controllers.listResourceRecords,
);
resourceRouter.get('/:resource/:id', controllers.getResourceRecord);
resourceRouter.post(
  '/:resource',
  middleware.validateResourceCreation,
  controllers.createResourceRecord,
);
resourceRouter.patch(
  '/:resource/:id',
  middleware.validateResourceUpdate,
  controllers.updateResourceRecord,
);
