import pino from 'pino';
import { config } from '../config/environment.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.accessToken',
      '*.secret',
      '*.customerPhone',
      '*.email',
      '*.phoneNumber',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'whalexy-backend' },
});
