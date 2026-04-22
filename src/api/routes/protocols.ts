import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getProtocolByCdt, listAllProtocols } from '../../protocols/service.js';
import { NotFoundError } from '../../lib/errors.js';

const router: IRouter = Router();

const cdtParamSchema = z.object({
  cdtCode: z.string().regex(/^D\d{4}$/, 'CDT code must be in format D1234'),
});

router.get('/:cdtCode', requireAuth, async (req, res, next) => {
  try {
    const { cdtCode } = cdtParamSchema.parse(req.params);
    const protocols = await getProtocolByCdt(cdtCode);

    if (protocols.length === 0) {
      throw new NotFoundError(`Protocol for CDT code ${cdtCode}`);
    }

    res.json({ cdtCode, protocols });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const protocols = await listAllProtocols();
    res.json({ count: protocols.length, protocols });
  } catch (err) {
    next(err);
  }
});

export default router;
