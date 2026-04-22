-- Clinical protocol rows seeded from OrthoNu_Clinical_Protocol_Master_Chart.xlsx
-- One row per (cdt_code, orthonu_product) pair — 80 rows total
CREATE TABLE IF NOT EXISTS protocols (
  id                  SERIAL PRIMARY KEY,
  cdt_code            TEXT    NOT NULL,
  diagnosis           TEXT    NOT NULL,
  specialty           TEXT    NOT NULL,
  orthonu_product_id  INTEGER NOT NULL REFERENCES orthonu_products(id),
  icd10_code          TEXT,
  confidence_pct      INTEGER,
  trigger_condition   TEXT,
  application_notes   TEXT,
  follow_up_protocol  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protocols_cdt ON protocols(cdt_code);
CREATE INDEX IF NOT EXISTS idx_protocols_product ON protocols(orthonu_product_id);
