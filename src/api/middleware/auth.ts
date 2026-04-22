import type { Request, Response, NextFunction } from 'express';
import { verifyOverlayToken } from '../../auth/jwt.js';
import { UnauthorizedError } from '../../lib/errors.js';

declare global {
  namespace Express {
    interface Request {
      clinicId?: string;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing Authorization header'));
  }

  try {
    const payload = await verifyOverlayToken(header.slice(7));
    req.clinicId = payload.clinicId;
    next();
  } catch (err) {
    next(err);
  }
}
