import { pool } from '../db/pool.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { DentiraError } from '../lib/errors.js';

interface TokenResponse {
  // Auth spec says access_token; live sandbox returns accessToken — handle both
  access_token?: string;
  accessToken?: string;
  token_type?: string;
  tokenType?: string;
  expires_in?: number;
  expiresIn?: number;
}

interface CachedToken {
  access_token: string;
  expires_at: Date;
}

// Refresh at 90% of expires_in to avoid using an about-to-expire token
const REFRESH_THRESHOLD = 0.9;

class DentiraTokenManager {
  private memCache: CachedToken | null = null;

  async getToken(): Promise<string> {
    // 1. Check in-memory cache first (fast path)
    if (this.memCache && this.isValid(this.memCache)) {
      return this.memCache.access_token;
    }

    // 2. Check DB cache
    const dbToken = await this.loadFromDb();
    if (dbToken && this.isValid(dbToken)) {
      this.memCache = dbToken;
      return dbToken.access_token;
    }

    // 3. Fetch a fresh token
    return this.refresh();
  }

  private isValid(token: CachedToken): boolean {
    return token.expires_at > new Date();
  }

  private async loadFromDb(): Promise<CachedToken | null> {
    const { rows } = await pool.query<{ access_token: string; expires_at: Date }>(
      'SELECT access_token, expires_at FROM dentira_auth_tokens WHERE id = 1',
    );
    return rows[0] ?? null;
  }

  async refresh(): Promise<string> {
    logger.info('Fetching fresh Dentira access token');

    const res = await fetch(`${config.DENTIRA_BASE_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.DENTIRA_CLIENT_ID,
        client_secret: config.DENTIRA_CLIENT_SECRET,
        flow: 'CLIENT_CREDENTIALS',
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DentiraError(`Token fetch failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as TokenResponse;
    // Live sandbox returns camelCase; spec says snake_case — handle both
    const token = data.access_token ?? data.accessToken;
    const expiresIn = data.expires_in ?? data.expiresIn ?? 3600;

    if (!token) {
      throw new DentiraError('Token response missing access_token field');
    }

    const expiresAt = new Date(Date.now() + expiresIn * REFRESH_THRESHOLD * 1000);

    await pool.query(
      `INSERT INTO dentira_auth_tokens (id, access_token, expires_at)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             expires_at   = EXCLUDED.expires_at,
             created_at   = NOW()`,
      [token, expiresAt],
    );

    this.memCache = { access_token: token, expires_at: expiresAt };
    logger.info({ expiresAt }, 'Dentira token refreshed and cached');

    return token;
  }

  // Force-refresh on 401/403 response from Dentira
  async forceRefresh(): Promise<string> {
    this.memCache = null;
    return this.refresh();
  }
}

// Singleton
export const dentiraTokenManager = new DentiraTokenManager();
