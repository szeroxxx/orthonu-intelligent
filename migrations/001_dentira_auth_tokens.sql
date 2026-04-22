-- Dentira OAuth token cache — single-row table, UPSERT on every refresh
CREATE TABLE IF NOT EXISTS dentira_auth_tokens (
  id           INTEGER PRIMARY KEY DEFAULT 1,  -- always row 1
  access_token TEXT    NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);
