import { readFileSync } from 'fs';
import { importPKCS8, SignJWT } from 'jose';
import { randomUUID } from 'crypto';
import { pool } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { loadEpicConfig } from '../config.js';

interface TokenRow {
  access_token: string;
  expires_at: Date;
  scope: string | null;
}

// Private key PEM is read once and cached — it never changes at runtime.
let _privateKeyPem: string | null = null;

function getPrivateKeyPem(): string {
  if (_privateKeyPem) return _privateKeyPem;
  const cfg = loadEpicConfig();
  _privateKeyPem = readFileSync(cfg.EPIC_PRIVATE_KEY_PATH, 'utf8');
  return _privateKeyPem;
}

async function signClientAssertion(fhirServer: string): Promise<string> {
  const cfg = loadEpicConfig();
  const pem = getPrivateKeyPem();
  const privateKey = await importPKCS8(pem, 'RS384');

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS384', kid: cfg.EPIC_KEY_ID, typ: 'JWT' })
    .setIssuer(cfg.EPIC_CLIENT_ID)
    .setSubject(cfg.EPIC_CLIENT_ID)
    .setAudience(`${fhirServer}/oauth2/token`)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function fetchNewToken(fhirServer: string): Promise<string> {
  const assertion = await signClientAssertion(fhirServer);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });

  const resp = await fetch(`${fhirServer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(
      new Error(`Epic token endpoint returned ${resp.status}: ${text}`),
      { statusCode: resp.status },
    );
  }

  const json = (await resp.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  // Upsert into cache table.
  const expiresAt = new Date(Date.now() + json.expires_in * 1000);
  await pool.query(
    `INSERT INTO epic_access_tokens (fhir_server, access_token, expires_at, scope)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (fhir_server)
     DO UPDATE SET access_token = EXCLUDED.access_token,
                   expires_at   = EXCLUDED.expires_at,
                   scope        = EXCLUDED.scope,
                   updated_at   = NOW()`,
    [fhirServer, json.access_token, expiresAt, json.scope ?? null],
  );

  // NEVER log the token value.
  logger.info({ fhirServer, expiresAt }, 'Epic access token refreshed');
  return json.access_token;
}

async function clearCachedToken(fhirServer: string): Promise<void> {
  await pool.query(`DELETE FROM epic_access_tokens WHERE fhir_server = $1`, [fhirServer]);
}

/**
 * Returns a valid Bearer token for the given Epic FHIR server.
 * Reads from the DB cache; refreshes 60 s before expiry.
 * On 401/403 from Epic, clears the cache and retries once.
 */
export async function getEpicAccessToken(
  fhirServer: string,
  isRetry = false,
): Promise<string> {
  // Check DB cache first.
  const { rows } = await pool.query<TokenRow>(
    `SELECT access_token, expires_at, scope
     FROM epic_access_tokens
     WHERE fhir_server = $1`,
    [fhirServer],
  );

  if (rows.length > 0) {
    const { access_token, expires_at } = rows[0];
    const secsRemaining = (expires_at.getTime() - Date.now()) / 1000;
    if (secsRemaining > 60) {
      return access_token;
    }
    // Token expires soon — fall through to refresh.
  }

  try {
    return await fetchNewToken(fhirServer);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if ((status === 401 || status === 403) && !isRetry) {
      logger.warn({ fhirServer, status }, 'Epic token 401/403 — clearing cache and retrying');
      await clearCachedToken(fhirServer);
      return getEpicAccessToken(fhirServer, true);
    }
    // Wrap so callers (pg-boss workers) receive a structured error for retry.
    throw Object.assign(new Error(`Failed to obtain Epic access token: ${(err as Error).message}`), {
      fhirServer,
      epicTokenError: true,
    });
  }
}

/** Clears cached token for a specific server — called when FHIR calls return 401/403. */
export async function invalidateEpicAccessToken(fhirServer: string): Promise<void> {
  await clearCachedToken(fhirServer);
}
