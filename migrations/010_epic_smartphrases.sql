-- Epic CDS Hooks: SmartPhrase library — seeded by scripts/seed-smartphrases.ts
-- 42 phrases across 5 categories (Core/Product/Scenario/Operational/Diagnosis).
-- GIN indexes on array columns for fast CDT/ICD-10 membership queries.
CREATE TABLE epic_smartphrases (
  id                    BIGSERIAL PRIMARY KEY,
  phrase_id             TEXT UNIQUE NOT NULL,       -- dot-separated e.g. SCENARIO.PERIO.CHILLIN
  category              TEXT NOT NULL,              -- 'Core' | 'Product' | 'Scenario' | 'Operational' | 'Diagnosis'
  title                 TEXT NOT NULL,
  body_markdown         TEXT NOT NULL,              -- contains {PLACEHOLDER} tokens
  placeholder_tokens    TEXT[] NOT NULL,            -- extracted token names (no braces)
  cdt_codes             TEXT[],                     -- NULL for Core/Operational phrases
  icd10_codes           TEXT[],                     -- NULL for Core/Operational phrases
  orthonu_product_id    BIGINT REFERENCES orthonu_products(id),
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_epic_smartphrases_cat_active ON epic_smartphrases (category, active);
CREATE INDEX idx_epic_smartphrases_cdt_codes  ON epic_smartphrases USING GIN (cdt_codes);
CREATE INDEX idx_epic_smartphrases_icd10      ON epic_smartphrases USING GIN (icd10_codes);
