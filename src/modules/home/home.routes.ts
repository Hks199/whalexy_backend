import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { getPublicPolicyParamsSchema } from './home.validation.js';
import * as controllers from './home.controller.js';

export const homeRouter = Router();
homeRouter.get('/home', controllers.getPublicHome);
homeRouter.get(
  '/policies/:policy',
  validate(getPublicPolicyParamsSchema, 'params'),
  controllers.getPublicPolicy,
);
