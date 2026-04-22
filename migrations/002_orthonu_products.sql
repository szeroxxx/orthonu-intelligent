-- OrthoNu product catalog (7 products, seeded by scripts/seed-protocols.ts)
CREATE TABLE IF NOT EXISTS orthonu_products (
  id             SERIAL PRIMARY KEY,
  name           TEXT    NOT NULL,
  sku            TEXT    NOT NULL UNIQUE,
  msrp_cents     INTEGER NOT NULL,
  dso_price_cents INTEGER,
  dissolvable    BOOLEAN NOT NULL DEFAULT FALSE,
  category       TEXT    NOT NULL,
  description    TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
