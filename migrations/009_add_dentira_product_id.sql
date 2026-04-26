-- Add dentira_product_id column (ORTHO_BRACES_KIT format) and enforce unique variantId
-- Deepankar confirmed the full mapping on 2026-04-23

ALTER TABLE dentira_variant_map
  ADD COLUMN IF NOT EXISTS dentira_product_id TEXT;

-- UNIQUE on dentira_variant_id (NULLs are not considered equal in PostgreSQL, so existing
-- NULL rows are unaffected; only non-NULL values must be distinct)
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_map_dentira_variant_id
  ON dentira_variant_map (dentira_variant_id)
  WHERE dentira_variant_id IS NOT NULL;
