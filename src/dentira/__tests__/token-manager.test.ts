import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool before importing the token manager
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock config
vi.mock('../../config/index.js', () => ({
  config: {
    DENTIRA_BASE_URL: 'https://vendor-caresbx.dentira.com',
    DENTIRA_CLIENT_ID: 'ortho_nu',
    DENTIRA_CLIENT_SECRET: 'test-secret',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { pool } from '../../db/pool.js';

describe('DentiraTokenManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a cached DB token when it is still valid', async () => {
    const futureDate = new Date(Date.now() + 3600_000);

    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ access_token: 'db-cached-token', expires_at: futureDate }],
    } as never);

    // Re-import to get a fresh instance (module cache will hold old memCache)
    const { dentiraTokenManager } = await import('../token-manager.js');
    // Clear in-memory cache by force
    // @ts-expect-error accessing private
    dentiraTokenManager.memCache = null;

    const token = await dentiraTokenManager.getToken();
    expect(token).toBe('db-cached-token');
  });

  it('fetches a fresh token when DB cache is empty', async () => {
    // DB returns no rows (empty cache)
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never) // loadFromDb
      .mockResolvedValueOnce({ rows: [] } as never); // upsert

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-token-from-dentira',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const { dentiraTokenManager } = await import('../token-manager.js');
    // @ts-expect-error accessing private
    dentiraTokenManager.memCache = null;

    const token = await dentiraTokenManager.getToken();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://vendor-caresbx.dentira.com/auth/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'ortho_nu',
          client_secret: 'test-secret',
          flow: 'CLIENT_CREDENTIALS',
        }),
      }),
    );
    expect(token).toBe('fresh-token-from-dentira');
  });

  it('throws DentiraError when token endpoint returns non-OK', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    vi.stubGlobal('fetch', mockFetch);

    const { dentiraTokenManager } = await import('../token-manager.js');
    // @ts-expect-error accessing private
    dentiraTokenManager.memCache = null;

    await expect(dentiraTokenManager.getToken()).rejects.toThrow('Token fetch failed: 401');
  });

  it('returns the in-memory cached token without hitting DB', async () => {
    const futureDate = new Date(Date.now() + 3600_000);

    const { dentiraTokenManager } = await import('../token-manager.js');
    // @ts-expect-error accessing private
    dentiraTokenManager.memCache = { access_token: 'mem-cached', expires_at: futureDate };

    const token = await dentiraTokenManager.getToken();

    expect(token).toBe('mem-cached');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
