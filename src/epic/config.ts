import { z } from 'zod';

const epicEnvSchema = z.object({
  EPIC_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  EPIC_CLIENT_ID_SANDBOX: z.string().optional(),
  EPIC_CLIENT_ID_PRODUCTION: z.string().optional(),
  EPIC_FHIR_BASE_URL: z.string().url('EPIC_FHIR_BASE_URL must be a valid URL'),
  EPIC_JWKS_URL: z.string().url().optional(),
  EPIC_EXPECTED_ISS: z.string().optional(),
  EPIC_PRIVATE_KEY_PATH: z.string().min(1, 'EPIC_PRIVATE_KEY_PATH is required'),
  EPIC_PUBLIC_KEY_PATH: z.string().min(1, 'EPIC_PUBLIC_KEY_PATH is required'),
  EPIC_KEY_ID: z.string().default('orthonu-sandbox-2026-04'),
  EPIC_CDS_BASE_URL: z.string().url('EPIC_CDS_BASE_URL must be a valid URL'),
  EPIC_SMART_LAUNCH_URL: z.string().url().optional(),
  // Test-only JWKS override — resolved at request time when NODE_ENV=test.
  // Production code path NEVER uses this variable.
  EPIC_TEST_JWKS_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type EpicEnvParsed = z.infer<typeof epicEnvSchema>;

export interface EpicConfig extends EpicEnvParsed {
  EPIC_CLIENT_ID: string; // resolved from SANDBOX or PRODUCTION based on EPIC_ENV
}

let _config: EpicConfig | null = null;

export function loadEpicConfig(): EpicConfig {
  if (_config) return _config;

  const parsed = epicEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Epic config invalid: ${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`,
    );
  }

  const d = parsed.data;

  // Resolve the active client ID; fail fast at startup if missing.
  const clientId =
    d.EPIC_ENV === 'sandbox' ? d.EPIC_CLIENT_ID_SANDBOX : d.EPIC_CLIENT_ID_PRODUCTION;

  if (!clientId) {
    throw new Error(
      d.EPIC_ENV === 'sandbox'
        ? 'EPIC_CLIENT_ID_SANDBOX is required when EPIC_ENV=sandbox'
        : 'EPIC_CLIENT_ID_PRODUCTION is required when EPIC_ENV=production',
    );
  }

  _config = { ...d, EPIC_CLIENT_ID: clientId };
  return _config;
}

/** Reset cached config — only for unit tests. */
export function _resetEpicConfigCache(): void {
  _config = null;
}
