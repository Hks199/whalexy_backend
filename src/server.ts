import { createApp } from './app.js';
import { config } from './config/environment.js';
import { db } from './database/client.js';
import { logger } from './observability/logger.js';

await db.$connect();
const server = createApp().listen(config.PORT, () =>
  logger.info({ port: config.PORT }, 'API started'),
);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  logger.info('API shutting down');
  server.close(() => {
    void db.$disconnect().then(() => process.exit(0));
  });
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
