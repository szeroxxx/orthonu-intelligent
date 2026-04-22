-- Maps OrthoNu products to Dentira Care variantIds
-- Deepankar will supply real variantIds; placeholder rows use NULL
CREATE TABLE IF NOT EXISTS dentira_variant_map (
  id                  SERIAL PRIMARY KEY,
  orthonu_product_id  INTEGER NOT NULL REFERENCES orthonu_products(id) ON DELETE CASCADE,
  dentira_variant_id  TEXT,           -- NULL until Deepankar confirms real IDs
  concentration       TEXT,
  packaging           INTEGER,
  packaging_uom       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_map_product ON dentira_variant_map(orthonu_product_id);
CREATE INDEX IF NOT EXISTS idx_variant_map_variant ON dentira_variant_map(dentira_variant_id)
  WHERE dentira_variant_id IS NOT NULL;
