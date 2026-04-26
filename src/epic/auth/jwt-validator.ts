import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../lib/logger.js';
import { loadEpicConfig } from '../config.js';

// Augment Express Request with Epic JWT claims.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      epicJwt?: {
        iss?: string;
        sub?: string;
        aud?: string | string[];
        iat?: number;
        exp?: number;
        jti?: string;
        tenant?: string;
        [key: string]: unknown;
      };
    }
  }
}

// Module-level JWKS cache — createRemoteJWKSet manages the 10-min TTL internally.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks) return _jwks;

  const cfg = loadEpicConfig();

  // DECISION: when NODE_ENV=test AND EPIC_TEST_JWKS_URL is set, use the test
  // JWKS URL so integration tests can sign their own assertions without hitting
  // Epic's live JWKS endpoint. The production code path NEVER reads
  // EPIC_TEST_JWKS_URL — the guard below enforces this.
  const jwksUrl =
    cfg.NODE_ENV === 'test' && cfg.EPIC_TEST_JWKS_URL
      ? cfg.EPIC_TEST_JWKS_URL
      : cfg.EPIC_JWKS_URL;

  if (!jwksUrl) {
    throw new Error(
      'EPIC_JWKS_URL is required for JWT validation. Set it to Epic\'s sandbox JWKS URL.',
    );
  }

  _jwks = createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    cooldownDuration: 30 * 1000, // 30 seconds
  });

  return _jwks;
}

/** Express middleware. Validates Epic-signed RS384 JWT on every CDS hook request. */
export function validateEpicJwt(req: Request, res: Response, next: NextFunction): void {
  _validateAsync(req, res, next).catch(err => {
    // Unexpected internal error — surface as 500, not 401
    logger.error({ err }, 'Epic JWT validator threw unexpectedly');
    res.status(500).json({ error: 'internal_error' });
  });
}

async function _validateAsync(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'invalid_token', reason: 'missing_bearer' });
    return;
  }

  // NEVER log the token — not even a prefix.
  const token = authHeader.slice(7);
  const cfg = loadEpicConfig();

  // Audience = the exact URL being called (service-specific, including /feedback suffix).
  // Epic signs the JWT for the full path it is POSTing to.
  const requestPath = (req.baseUrl + req.path).replace(/\/$/, '');
  const audience = `${cfg.EPIC_CDS_BASE_URL}${requestPath}`;

  let jwks: ReturnType<typeof createRemoteJWKSet>;
  try {
    jwks = getJwks();
  } catch (err) {
    logger.error({ err }, 'JWKS endpoint not configured');
    res.status(503).json({ error: 'service_not_configured', reason: 'jwks_not_configured' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS384'],
      ...(cfg.EPIC_EXPECTED_ISS ? { issuer: cfg.EPIC_EXPECTED_ISS } : {}),
      audience,
      clockTolerance: 5, // seconds
    });

    // Verify sub matches our registered client ID.
    if (payload.sub !== cfg.EPIC_CLIENT_ID) {
      logger.warn({ reason: 'sub_mismatch' }, 'Epic JWT sub does not match EPIC_CLIENT_ID');
      res.status(401).json({ error: 'invalid_token', reason: 'sub_mismatch' });
      return;
    }

    req.epicJwt = payload as typeof req.epicJwt;
    next();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? 'verification_failed';
    logger.warn({ reason: code }, 'Epic JWT validation failed');
    res.status(401).json({ error: 'invalid_token', reason: code });
  }
}

/** Reset module-level JWKS cache — for unit tests only. */
export function _resetJwksCache(): void {
  _jwks = null;
}
