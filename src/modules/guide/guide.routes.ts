import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import * as controllers from './guide.controller.js';

export const guideRouter = Router({ mergeParams: true });
guideRouter.get(
  '/',
  permit('administrative', 'vendor.dashboard.view'),
  controllers.getWorkspaceGuide,
);
