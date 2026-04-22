import fs from 'fs';
import path from 'path';
import { pool } from './pool.js';
import { logger } from '../lib/logger.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query<{ filename: string }>(
      'SELECT filename FROM _migrations ORDER BY filename',
    );
    const appliedSet = new Set(applied.map(r => r.filename));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        logger.debug({ file }, 'Migration already applied, skipping');
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      logger.info({ file }, 'Applying migration');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info({ file }, 'Migration applied successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('All migrations complete');
  } finally {
    client.release();
  }

  await pool.end();
}

runMigrations().catch(err => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
