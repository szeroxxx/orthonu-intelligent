import { getEpicAccessToken, invalidateEpicAccessToken } from '../auth/access-token.js';
import { logger } from '../../lib/logger.js';

interface FhirRequestOptions {
  fhirServer: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;                     // e.g. '/api/FHIR/R4/DocumentReference'
  body?: unknown;
  extraHeaders?: Record<string, string>;
  isRetry?: boolean;
}

interface FhirResponse<T> {
  status: number;
  body: T;
  location?: string;
}

/**
 * Thin FHIR R4 HTTP client. Uses Node 20 global fetch with a 10-second timeout.
 * On 401/403, clears the token cache and retries once (spec §12).
 */
export async function fhirRequest<T>(opts: FhirRequestOptions): Promise<FhirResponse<T>> {
  const { fhirServer, method, path, body, extraHeaders = {}, isRetry = false } = opts;

  const token = await getEpicAccessToken(fhirServer);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/fhir+json',
    Accept: 'application/fhir+json',
    ...extraHeaders,
  };

  const url = `${fhirServer}${path}`;

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  if (resp.status === 401 || resp.status === 403) {
    if (!isRetry) {
      logger.warn({ fhirServer, status: resp.status }, 'FHIR request auth failure — refreshing token');
      await invalidateEpicAccessToken(fhirServer);
      return fhirRequest<T>({ ...opts, isRetry: true });
    }
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`FHIR ${resp.status} after token refresh: ${text}`), {
      fhirStatus: resp.status,
      fhirServer,
    });
  }

  if (resp.status === 422) {
    // Unprocessable — do NOT retry (spec §12).
    const text = await resp.text().catch(() => '');
    logger.error({ fhirServer, path, status: 422, body: text }, 'FHIR 422 — not retrying');
    throw Object.assign(new Error(`FHIR 422 Unprocessable: ${text}`), {
      fhirStatus: 422,
      fhirServer,
      noRetry: true,
    });
  }

  if (resp.status >= 500) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`FHIR ${resp.status}: ${text}`), {
      fhirStatus: resp.status,
      fhirServer,
    });
  }

  const responseBody = await resp.json() as T;
  return {
    status: resp.status,
    body: responseBody,
    location: resp.headers.get('Location') ?? undefined,
  };
}
