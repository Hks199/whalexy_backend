import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import { logger } from '../observability/logger.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config/environment.js';
import { ApiError } from '../shared/api-error.js';
import { createAppRateLimit } from './rate-limit.js';

export function installPlatformMiddleware(app: Express) {
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.set('query parser', 'simple');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: (req.url ?? '').split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res) =>
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id));
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.origins.includes(origin)) callback(null, true);
        else callback(new ApiError(403, 'ORIGIN_DENIED', 'Origin is not allowed'));
      },
      credentials: false,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Vendor-Id'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(compression());
  app.use(createAppRateLimit());
}
