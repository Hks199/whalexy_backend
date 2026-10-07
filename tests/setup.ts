import dotenv from 'dotenv';
dotenv.config({ path: '.env.test', override: true, quiet: true });
if (
  process.env.NODE_ENV !== 'test' ||
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== '/whalexy_test'
)
  throw new Error('Tests require the isolated whalexy_test PostgreSQL database');
process.env.LOG_LEVEL = 'silent';
