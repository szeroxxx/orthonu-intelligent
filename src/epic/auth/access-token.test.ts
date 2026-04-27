import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB pool, filesystem, and jose before imports.
vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----'),
}));
vi.mock('jose', () => ({
  importPKCS8: vi.fn().mockResolvedValue('fake-private-key'),
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuer: vi.fn().mockReturnThis(),
    setSubject: vi.fn().mockReturnThis(),
    setAudience: vi.fn().mockReturnThis(),
    setJti: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue('signed.jwt.assertion'),
  })),
}));
vi.mock('../config.js', () => ({
  loadEpicConfig: vi.fn().mockReturnValue({
    EPIC_ENV: 'sandbox',
    EPIC_CLIENT_ID: '53f42d61-92ee-4db7-8698-5a27c3db8d4f',
    EPIC_KEY_ID: 'orthonu-sandbox-2026-04',
    EPIC_PRIVATE_KEY_PATH: '/tmp/priv.pem',
    EPIC_PUBLIC_KEY_PATH: '/tmp/pub.pem',
    EPIC_CDS_BASE_URL: 'https://cds.orthonu.com',
    EPIC_FHIR_BASE_URL: 'https://vendorservices.epic.com',
  }),
}));

import { getEpicAccessToken } from './access-token.js';
import { pool } from '../../db/pool.js';

const mockQuery = vi.mocked(pool.query as unknown as (...args: unknown[]) => unknown);

const FHIR_SERVER = 'https://vendorservices.epic.com/interconnect-amcurprd-oauth';
const FUTURE_EXPIRY = new Date(Date.now() + 30 * 60 * 1000); // 30 min from now
const NEAR_EXPIRY = new Date(Date.now() + 30 * 1000); // 30 sec from now (< 60s threshold)

beforeEach(() => {
  vi.clearAllMocks();
  // Reset global fetch mock
  vi.stubGlobal('fetch', vi.fn());
});

describe('getEpicAccessToken', () => {
  it('cache hit — returns cached token without hitting token endpoint', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token: 'cached-token', expires_at: FUTURE_EXPIRY, scope: 'system/Patient.read' }],
    });

    const token = await getEpicAccessToken(FHIR_SERVER);
    expect(token).toBe('cached-token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cache miss — signs assertion and calls token endpoint', async () => {
    // No cached token
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Upsert
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'system/Patient.read',
      }),
    } as Response);

    const token = await getEpicAccessToken(FHIR_SERVER);
    expect(token).toBe('new-token');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cache near expiry — refreshes token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ access_token: 'old-token', expires_at: NEAR_EXPIRY, scope: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    } as Response);

    const token = await getEpicAccessToken(FHIR_SERVER);
    expect(token).toBe('refreshed-token');
  });

  it('401 response from Epic — clears cache and retries once', async () => {
    // First call: no cache
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // DELETE (clear cache) — called by retry path
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second call: no cache (after clear)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second upsert
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'retry-token', expires_in: 3600, token_type: 'Bearer' }),
      } as Response);

    const token = await getEpicAccessToken(FHIR_SERVER);
    expect(token).toBe('retry-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('second 401 after retry — throws structured error', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    await expect(getEpicAccessToken(FHIR_SERVER)).rejects.toThrow('Failed to obtain Epic access token');
  });
});
