import * as middleware from './jobs-admin.middleware.js';
import { Router } from 'express';
import { authenticate, permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { listJobsQuerySchema, retryJobBodySchema } from './jobs-admin.validation.js';
import * as controllers from './jobs-admin.controller.js';

export function jobsRouter(central = false) {
  const router = Router({ mergeParams: true });
  if (central) router.use(authenticate, middleware.requireSiteAdministrator);
  else router.use(permit('vendor.integrations.manage'), middleware.requireJobOwner);
  router.get('/', validate(listJobsQuerySchema, 'query'), controllers.listJobs(central));
  router.post('/:id/retry', validate(retryJobBodySchema), controllers.retryJob(central));
  return router;
}
