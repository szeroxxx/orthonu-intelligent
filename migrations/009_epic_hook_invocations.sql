-- Epic CDS Hooks: invocation log — one row per hook call from Epic
-- patient_id stores the raw FHIR ID (opaque server-assigned identifier, not PHI per HIPAA).
-- Logs use patientIdHash (SHA256[:12]) instead; full ID stays in this table only.
CREATE TABLE epic_hook_invocations (
  id                    BIGSERIAL PRIMARY KEY,
  hook_instance         UUID UNIQUE NOT NULL,
  hook_type             TEXT NOT NULL,              -- 'patient-view' | 'order-select'
  service_id            TEXT NOT NULL,              -- 'orthonu-oral-intelligence' | 'orthonu-protocol-engine'
  fhir_server           TEXT NOT NULL,
  epic_client_id        TEXT NOT NULL,              -- JWT sub claim
  patient_id            TEXT,
  user_id               TEXT,
  encounter_id          TEXT,
  cdt_code              TEXT,                       -- extracted from draftOrders
  icd10_codes           TEXT[],                     -- extracted from prefetch
  matched_protocol_ids  BIGINT[],                   -- references protocols.id; NULL/empty = passive or no-match
  card_count            INT NOT NULL DEFAULT 0,
  suppressed            BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason    TEXT,
  response_time_ms      INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_epic_hook_inv_created_at ON epic_hook_invocations (created_at DESC);
CREATE INDEX idx_epic_hook_inv_cdt_code   ON epic_hook_invocations (cdt_code);
CREATE INDEX idx_epic_hook_inv_hook_type  ON epic_hook_invocations (hook_type);
