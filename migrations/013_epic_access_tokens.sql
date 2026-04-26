-- Epic CDS Hooks: access token cache for OrthoNu→Epic FHIR API calls
-- One row per Epic FHIR server (tenant). Token is refreshed when <60s from expiry.
-- updated_at trigger keeps the timestamp current on upserts.
CREATE TABLE epic_access_tokens (
  id            BIGSERIAL PRIMARY KEY,
  fhir_server   TEXT UNIQUE NOT NULL,
  access_token  TEXT NOT NULL,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
