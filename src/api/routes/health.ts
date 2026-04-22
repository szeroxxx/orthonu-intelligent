import { Router, type IRouter } from 'express';
import { checkDbConnection } from '../../db/pool.js';
import { dentiraTokenManager } from '../../dentira/token-manager.js';

const router: IRouter = Router();

router.get('/', async (_req, res) => {
  const dbConnected = await checkDbConnection();

  let dentiraTokenValid = false;
  try {
    await dentiraTokenManager.getToken();
    dentiraTokenValid = true;
  } catch {
    dentiraTokenValid = false;
  }

  const status = dbConnected ? 'ok' : 'degraded';
  res.status(dbConnected ? 200 : 503).json({
    status,
    dentiraTokenValid,
    dbConnected,
    timestamp: new Date().toISOString(),
  });
});

export default router;
