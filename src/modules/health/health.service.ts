import { db } from '../../database/client.js';

export async function readiness() {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
