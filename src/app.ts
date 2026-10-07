import express from 'express';
import { installPlatformMiddleware } from './middleware/platform.js';
import { registerRoutes } from './routes/index.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import './types/http.js';

export function createApp() {
  const app = express();
  installPlatformMiddleware(app);
  registerRoutes(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
