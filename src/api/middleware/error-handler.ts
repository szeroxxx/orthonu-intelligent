import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, err.message);
    } else {
      logger.warn({ code: err.code }, err.message);
    }
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
