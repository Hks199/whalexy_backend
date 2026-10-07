// Exercise the compiled app over a real local HTTP socket without persistent listeners.
import { createApp } from '../dist/src/app.js';
import { db } from '../dist/src/database/client.js';

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
try {
  const { port } = server.address();
  for (const path of ['/health/live', '/health/ready']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
    console.log(`${path}: HTTP ${response.status}`);
  }
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.$disconnect();
}
