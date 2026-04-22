import { Pool } from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pg pool error');
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
