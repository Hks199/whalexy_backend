import { rateLimit } from 'express-rate-limit';

// Each app owns its limiter. Use a shared store at the proxy before scaling instances.
export function createAppRateLimit() {
  return rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  });
}
export function createAuthRateLimit() {
  return rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication requests' } },
  });
}
