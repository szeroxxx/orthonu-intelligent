import type PgBoss from 'pg-boss';
import { createEpicRouter } from './router.js';
import { registerWriteBackWorker } from './workers/write-back-worker.js';
import { loadEpicConfig } from './config.js';
import { logger } from '../lib/logger.js';

// Validate Epic config at module load — fails fast if required vars are missing.
try {
  loadEpicConfig();
  logger.info({ env: process.env['EPIC_ENV'] ?? 'sandbox' }, 'Epic CDS Hooks module initialised');
} catch (err) {
  logger.warn({ err }, 'Epic config incomplete — Epic endpoints will fail until env vars are set');
}

export const epicRouter = createEpicRouter();

/**
 * Registers Epic pg-boss workers. Call this after boss.start() in server.ts.
 */
export async function registerEpicWorkers(boss: PgBoss): Promise<void> {
  await registerWriteBackWorker(boss);
}

// Re-export for use in tests / scripts.
export { loadEpicConfig } from './config.js';
export type { EpicConfig } from './config.js';
