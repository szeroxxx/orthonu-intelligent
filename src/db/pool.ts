import { Pool } from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

// Strip sslmode from the connection string so pg-connection-string doesn't
// override our ssl config (newer versions treat sslmode=require as verify-full).
const dbUrl = new URL(config.DATABASE_URL);
dbUrl.searchParams.delete('sslmode');

export const pool = new Pool({
  connectionString: dbUrl.toString(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pg pool error');
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch(err) {
    console.error('Database connection error:', err);
    return false;
  }
}
