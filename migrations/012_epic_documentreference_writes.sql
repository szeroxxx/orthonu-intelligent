-- Epic CDS Hooks: audit trail for DocumentReference.Create write-back calls
-- composed_note_text stored pre-base64 for human audit; base64 is in the FHIR payload.
CREATE TABLE epic_documentreference_writes (
  id                          BIGSERIAL PRIMARY KEY,
  hook_instance               UUID NOT NULL REFERENCES epic_hook_invocations(hook_instance),
  fhir_server                 TEXT NOT NULL,
  patient_id                  TEXT NOT NULL,
  encounter_id                TEXT,
  practitioner_id             TEXT,
  composed_note_text          TEXT NOT NULL,        -- pre-base64, for audit
  phrase_ids_used             TEXT[] NOT NULL,
  epic_documentreference_id   TEXT,                 -- returned by Epic after successful create
  status                      TEXT NOT NULL,        -- 'pending' | 'succeeded' | 'failed'
  error_message               TEXT,
  attempted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ
);

CREATE INDEX idx_epic_drwrites_status        ON epic_documentreference_writes (status);
CREATE INDEX idx_epic_drwrites_hook_instance ON epic_documentreference_writes (hook_instance);
