-- Epic CDS Hooks: clinician feedback on returned cards
-- hook_instance is nullable because the CDS Hooks 1.0 feedback body does not
-- mandate hookInstance — Epic typically sends it but we cannot rely on it.
-- DECISION: Made nullable rather than requiring a field not guaranteed by spec.
-- Write-back is only triggered when hook_instance IS present and invocation matched.
CREATE TABLE epic_cds_feedback (
  id                    BIGSERIAL PRIMARY KEY,
  hook_instance         UUID REFERENCES epic_hook_invocations(hook_instance),  -- nullable, see above
  card_uuid             UUID NOT NULL,
  outcome               TEXT NOT NULL,              -- 'accepted' | 'overridden' | 'dismissed'
  override_reason_code  TEXT,
  override_reason_text  TEXT,
  accepted_suggestions  UUID[],                     -- suggestion UUIDs the clinician accepted
  raw_feedback_jsonb    JSONB NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_epic_feedback_hook_instance ON epic_cds_feedback (hook_instance);
CREATE INDEX idx_epic_feedback_outcome       ON epic_cds_feedback (outcome);
