import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock jose and config before importing the validator.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
  jwtVerify: vi.fn(),
}));
vi.mock('../config.js', () => ({
  loadEpicConfig: vi.fn().mockReturnValue({
    EPIC_ENV: 'sandbox',
    EPIC_CLIENT_ID: '53f42d61-92ee-4db7-8698-5a27c3db8d4f',
    EPIC_JWKS_URL: 'https://fhir.epic.com/.well-known/jwks',
    EPIC_EXPECTED_ISS: 'https://fhir.epic.com/interconnect-fhir-oauth',
    EPIC_CDS_BASE_URL: 'https://cds.orthonu.com',
    EPIC_KEY_ID: 'orthonu-sandbox-2026-04',
    NODE_ENV: 'test',
    EPIC_PRIVATE_KEY_PATH: '/tmp/priv.pem',
    EPIC_PUBLIC_KEY_PATH: '/tmp/pub.pem',
    EPIC_FHIR_BASE_URL: 'https://vendorservices.epic.com',
  }),
}));

import { validateEpicJwt, _resetJwksCache } from './jwt-validator.js';
import { jwtVerify } from 'jose';

const mockJwtVerify = vi.mocked(jwtVerify);

function makeReqRes(authHeader?: string, params?: Record<string, string>) {
  const req = {
    headers: { authorization: authHeader },
    params: params ?? { serviceId: 'orthonu-protocol-engine' },
    baseUrl: '',
    path: '/cds-services/orthonu-protocol-engine',
    epicJwt: undefined,
  } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, headersSent: false } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

beforeEach(() => {
  _resetJwksCache();
  vi.clearAllMocks();
});

describe('validateEpicJwt middleware', () => {
  it('valid JWT → next() called', async () => {
    const { req, res, next } = makeReqRes('Bearer valid.jwt.token');
    mockJwtVerify.mockResolvedValue({
      payload: {
        iss: 'https://fhir.epic.com/interconnect-fhir-oauth',
        sub: '53f42d61-92ee-4db7-8698-5a27c3db8d4f',
        aud: 'https://cds.orthonu.com/cds-services/orthonu-protocol-engine',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      protectedHeader: { alg: 'RS384', kid: 'epic-kid' },
    } as never);

    await new Promise<void>(resolve => {
      vi.mocked(next as unknown as (...args: unknown[]) => void).mockImplementation(resolve as () => void);
      validateEpicJwt(req, res, next);
    });

    expect(next).toHaveBeenCalled();
    expect(req.epicJwt).toBeDefined();
  });

  it('missing Bearer → 401 with missing_bearer', async () => {
    const { req, res, next, status, json } = makeReqRes(undefined);

    await new Promise<void>(resolve => {
      vi.mocked(res.status as unknown as (...args: unknown[]) => unknown).mockImplementation(
        (code: unknown) => {
          expect(code).toBe(401);
          resolve();
          return { json: vi.fn() };
        },
      );
      validateEpicJwt(req, res, next);
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('wrong algorithm (RS256) → 401', async () => {
    const { req, res, next } = makeReqRes('Bearer bad.alg.token');
    mockJwtVerify.mockRejectedValue(Object.assign(new Error('alg mismatch'), { code: 'ERR_JOSE_ALG_NOT_ALLOWED' }));

    validateEpicJwt(req, res, next);
    await new Promise(r => setTimeout(r, 10));

    expect(next).not.toHaveBeenCalled();
  });

  it('expired token → 401', async () => {
    const { req, res, next } = makeReqRes('Bearer expired.token');
    mockJwtVerify.mockRejectedValue(Object.assign(new Error('exp'), { code: 'ERR_JWT_EXPIRED' }));

    validateEpicJwt(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(next).not.toHaveBeenCalled();
  });

  it('wrong audience → 401', async () => {
    const { req, res, next } = makeReqRes('Bearer wrong.aud.token');
    mockJwtVerify.mockRejectedValue(Object.assign(new Error('aud'), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' }));

    validateEpicJwt(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(next).not.toHaveBeenCalled();
  });

  it('wrong sub → 401 with sub_mismatch', async () => {
    const { req, res, next } = makeReqRes('Bearer wrong.sub.token');
    mockJwtVerify.mockResolvedValue({
      payload: {
        iss: 'https://fhir.epic.com/interconnect-fhir-oauth',
        sub: 'WRONG-CLIENT-ID',
        aud: 'https://cds.orthonu.com/cds-services/orthonu-protocol-engine',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      protectedHeader: { alg: 'RS384' },
    } as never);

    validateEpicJwt(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(next).not.toHaveBeenCalled();
  });
});
