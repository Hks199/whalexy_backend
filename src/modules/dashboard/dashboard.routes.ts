import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import * as controllers from './dashboard.controller.js';

export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.get('/', permit('vendor.dashboard.view'), controllers.getDashboardSummary);
