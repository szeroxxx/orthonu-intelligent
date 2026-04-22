import { Router, type IRouter } from 'express';
import { handleDentiraWebhook } from '../../dentira/webhook-handler.js';

const router: IRouter = Router();

// Dentira Care sends order events here when a patient places an order
// No JWT auth — verified by Dentira signature instead (stubbed for now)
router.post('/dentira/orders', (req, res) => {
  handleDentiraWebhook(req, res).catch(err => {
    // Ensure we always return 200 to Dentira even on unexpected errors
    if (!res.headersSent) {
      res.status(200).json({ status: 'error', message: String(err) });
    }
  });
});

export default router;
