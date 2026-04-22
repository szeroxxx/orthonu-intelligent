import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { signOverlayToken } from '../../auth/jwt.js';

const router: IRouter = Router();

const loginSchema = z.object({
  clinicId: z.string().min(1),
  apiKey: z.string().min(1),
});

// Simple demo auth — for pilot, any clinicId + apiKey pair is accepted.
// TODO: Replace with a real clinic credential check against a clinics table.
const DEMO_API_KEY = 'orthonu-demo-key-2026';

router.post('/login', async (req, res, next) => {
  try {
    const { clinicId, apiKey } = loginSchema.parse(req.body);

    if (apiKey !== DEMO_API_KEY) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = await signOverlayToken(clinicId);
    res.json({ token, expiresIn: '8h' });
  } catch (err) {
    next(err);
  }
});

export default router;
