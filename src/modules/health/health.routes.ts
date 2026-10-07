import { Router } from 'express';
import { liveness, readiness } from './health.controller.js';

export const healthRouter = Router();
healthRouter.get('/live', liveness);
healthRouter.get('/ready', readiness);
