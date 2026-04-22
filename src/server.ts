import 'dotenv/config';
import express, { type Express } from 'express';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { checkDbConnection } from './db/pool.js';
import { startJobWorkers } from './jobs/index.js';
import { errorHandler } from './api/middleware/error-handler.js';

import authRoutes        from './api/routes/auth.js';
import protocolRoutes    from './api/routes/protocols.js';
import prescriptionRoutes from './api/routes/prescriptions.js';
import webhookRoutes     from './api/routes/webhooks.js';
import healthRoutes      from './api/routes/health.js';

const app: Express = express();

// Capture raw body for webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }), (req, _res, next) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
  req.body = JSON.parse((req.body as Buffer).toString('utf8'));
  next();
});

app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/health',             healthRoutes);
app.use('/api/auth',           authRoutes);
app.use('/api/protocols',      protocolRoutes);
app.use('/api/prescriptions',  prescriptionRoutes);
app.use('/webhooks',           webhookRoutes);

app.use(errorHandler);

async function main() {
  const dbOk = await checkDbConnection();
  if (!dbOk) {
    logger.error('Cannot connect to PostgreSQL — exiting');
    process.exit(1);
  }
  logger.info('PostgreSQL connection verified');

  await startJobWorkers();

  app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV, demoMode: config.DEMO_MODE },
      'OrthoNu backend listening',
    );
  });
}

main().catch(err => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});

export default app;
