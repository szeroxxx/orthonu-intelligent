import { readFileSync } from 'fs';
import { importSPKI, exportJWK } from 'jose';
import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { loadEpicConfig } from '../config.js';

// Public JWK is cached at module load — the file doesn't change at runtime.
let _cachedJwk: Record<string, unknown> | null = null;

async function loadPublicJwk(): Promise<Record<string, unknown>> {
  if (_cachedJwk) return _cachedJwk;

  const cfg = loadEpicConfig();
  const pem = readFileSync(cfg.EPIC_PUBLIC_KEY_PATH, 'utf8');

  // Public key PEM is SPKI format (-----BEGIN PUBLIC KEY-----)
  const key = await importSPKI(pem, 'RS384');
  const jwk = await exportJWK(key);

  _cachedJwk = {
    ...jwk,
    kid: cfg.EPIC_KEY_ID,
    use: 'sig',
    alg: 'RS384',
  };
  return _cachedJwk;
}

// Pre-load the JWK at startup so first request is fast.
// Logs a warning if the file is missing — the server still starts.
loadPublicJwk().catch(err => {
  logger.warn({ err }, 'Epic public key could not be loaded at startup — check EPIC_PUBLIC_KEY_PATH');
});

/** GET /.well-known/jwks.json — Epic fetches this to verify OrthoNu JWT assertions. */
export async function jwksHandler(req: Request, res: Response): Promise<void> {
  try {
    const jwk = await loadPublicJwk();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ keys: [jwk] });
  } catch (err) {
    logger.error({ err }, 'Failed to serve JWKS endpoint');
    res.status(500).json({ error: 'internal_error' });
  }
}

/** Reset JWK cache — for unit tests only. */
export function _resetJwkCache(): void {
  _cachedJwk = null;
}
