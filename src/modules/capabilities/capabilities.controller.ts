import type { RequestHandler } from 'express';
import { getCapabilities as describeCapabilities } from './capabilities.service.js';

export const getCapabilities: RequestHandler = (_req, res) => {
  res.json(describeCapabilities());
};
