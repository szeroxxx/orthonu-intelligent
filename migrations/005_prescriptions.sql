-- Dentira Care prescriptions created by OrthoNu via createTemplatePrescription
CREATE TABLE IF NOT EXISTS prescriptions (
  id                      SERIAL PRIMARY KEY,
  dentira_prescription_id TEXT UNIQUE,           -- data.createTemplatePrescription.id
  patient_email           TEXT    NOT NULL,
  patient_name            TEXT    NOT NULL,
  protocol_id             INTEGER REFERENCES protocols(id),
  prescription_code       TEXT,
  qr_image_url            TEXT,
  pdf_file_url            TEXT,
  status                  TEXT    NOT NULL DEFAULT 'DRAFT',
  raw_response_jsonb      JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_dentira_id ON prescriptions(dentira_prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient    ON prescriptions(patient_email);
