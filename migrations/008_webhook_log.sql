-- Audit log of every inbound webhook — stored before processing for idempotency
CREATE TABLE IF NOT EXISTS webhook_log (
  id             SERIAL PRIMARY KEY,
  source         TEXT    NOT NULL DEFAULT 'dentira',
  payload_jsonb  JSONB   NOT NULL,
  signature      TEXT,               -- raw signature header value
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_processed ON webhook_log(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_log_created   ON webhook_log(created_at);
