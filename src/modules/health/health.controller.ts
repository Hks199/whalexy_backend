import type { RequestHandler } from 'express';
import { readiness as checkDatabaseReadiness } from './health.service.js';

export const liveness: RequestHandler = (_req, res) => {
  res.json({ status: 'ok' });
};
export const readiness: RequestHandler = async (_req, res) => {
  const available = await checkDatabaseReadiness();
  res.status(available ? 200 : 503).json({ status: available ? 'ready' : 'unavailable' });
};
