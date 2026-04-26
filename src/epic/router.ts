import { Router } from 'express';
import { jwksHandler } from './auth/jwks-endpoint.js';
import { validateEpicJwt } from './auth/jwt-validator.js';
import { serviceDiscoveryHandler } from './discovery/service-discovery.js';
import { orderSelectHandler } from './hooks/order-select.js';
import { patientViewHandler } from './hooks/patient-view.js';
import { feedbackHandler } from './hooks/feedback.js';

// express-rate-limit is used only on authenticated CDS endpoints.
// Dynamically required so startup doesn't fail if the package is temporarily missing.
let rateLimit: ((opts: object) => (req: unknown, res: unknown, next: () => void) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  rateLimit = require('express-rate-limit').default ?? require('express-rate-limit');
} catch {
  // If package is not installed, skip rate limiting and log a warning at router init.
  console.warn('[epic] express-rate-limit not installed — CDS endpoints will NOT be rate-limited. Run: pnpm add express-rate-limit');
}

const cdsLimiter = rateLimit
  ? rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'rate_limit_exceeded' },
    })
  : (_req: unknown, _res: unknown, next: () => void) => next();

export function createEpicRouter(): Router {
  const router = Router({ mergeParams: true });

  // ── Public endpoints (no JWT required) ──────────────────────────────────────
  // Epic fetches the JWKS to verify our JWT assertions.
  router.get('/.well-known/jwks.json', jwksHandler);

  // Service discovery — Epic polls this at configuration time and periodically.
  router.get('/cds-services', serviceDiscoveryHandler);

  // ── Protected endpoints (JWT validated, rate limited) ───────────────────────
  // serviceId param captures 'orthonu-oral-intelligence' or 'orthonu-protocol-engine'.
  // validateEpicJwt uses req.params.serviceId to build the expected audience URL.

  // order-select hook
  router.post(
    '/cds-services/orthonu-protocol-engine',
    cdsLimiter as never,
    validateEpicJwt,
    (req, res) => {
      orderSelectHandler(req, res).catch(err => {
        res.status(500).json({ error: 'internal_error' });
        throw err;
      });
    },
  );

  // order-select feedback
  router.post(
    '/cds-services/orthonu-protocol-engine/feedback',
    cdsLimiter as never,
    validateEpicJwt,
    (req, res) => {
      feedbackHandler(req, res).catch(err => {
        if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
        throw err;
      });
    },
  );

  // patient-view hook
  router.post(
    '/cds-services/orthonu-oral-intelligence',
    cdsLimiter as never,
    validateEpicJwt,
    (req, res) => {
      patientViewHandler(req, res).catch(err => {
        res.status(500).json({ error: 'internal_error' });
        throw err;
      });
    },
  );

  // patient-view feedback
  router.post(
    '/cds-services/orthonu-oral-intelligence/feedback',
    cdsLimiter as never,
    validateEpicJwt,
    (req, res) => {
      feedbackHandler(req, res).catch(err => {
        if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
        throw err;
      });
    },
  );

  return router;
}
