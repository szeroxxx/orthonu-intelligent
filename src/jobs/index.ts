import PgBoss from 'pg-boss';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { processOrder, type ProcessOrderJobData } from '../dentira/order-processor.js';

export let bossInstance: PgBoss;

export async function startJobWorkers(): Promise<PgBoss> {
  const boss = new PgBoss(config.DATABASE_URL);

  boss.on('error', err => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  logger.info('pg-boss started');

  await boss.work<ProcessOrderJobData>('process-order', async job => {
    logger.info({ jobId: job.id }, 'Processing order job');
    await processOrder(job.data);
  });

  logger.info('Job workers registered');
  bossInstance = boss;
  return boss;
}
