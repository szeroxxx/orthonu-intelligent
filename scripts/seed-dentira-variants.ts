/**
 * Seeds the confirmed Dentira variantId + productId mapping for all 7 OrthoNu products.
 * Source: Deepankar (Dentira), 2026-04-23.
 *
 * Run: pnpm seed:variants
 * Idempotent — safe to re-run (ON CONFLICT DO UPDATE).
 * Fails loudly if any of the 7 products is not found in orthonu_products.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/lib/logger.js';

const VARIANT_MAPPING = [
  {
    variantId: 'DN-ON-1001',
    productId: 'ORTHO_BRACES_KIT',
    productName: 'Braces Starter Collection',
  },
  {
    variantId: 'DN-ON-1002',
    productId: 'ORTHO_ALIGNER_KIT',
    productName: 'Aligner Starter Collection',
  },
  {
    variantId: 'DN-ON-1003',
    productId: 'ORTHO_COMFORT_TAPE',
    productName: 'Comfort Tape',
  },
  {
    variantId: 'DN-ON-1004',
    productId: 'ORTHO_CHILLIN_STRIPS',
    productName: "Chillin' Strips",
  },
  {
    variantId: 'DN-ON-1005',
    productId: 'ORTHO_ORAL_RELIEF_KIT',
    productName: 'Oral Relief Kit',
  },
  {
    variantId: 'DN-ON-1006',
    productId: 'ORTHO_MOUTH_AID',
    productName: 'Mouth-Aid',
  },
  {
    variantId: 'DN-ON-1007',
    productId: 'ORTHO_CHEWZ',
    productName: 'OrthoChewz',
  },
] as const;

async function seedVariants() {
  logger.info('Applying Dentira variantId mapping (source: Deepankar, 2026-04-23)...');

  let applied = 0;

  for (const mapping of VARIANT_MAPPING) {
    // Look up the OrthoNu product by name (case-insensitive, apostrophe-insensitive, trimmed)
    const { rows: productRows } = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM orthonu_products
       WHERE LOWER(REGEXP_REPLACE(TRIM(name), $2, '', 'g'))
           = LOWER(REGEXP_REPLACE(TRIM($1), $2, '', 'g'))`,
      [mapping.productName, "[^a-zA-Z0-9 ]"],
    );

    if (productRows.length === 0) {
      logger.error(
        { productName: mapping.productName, variantId: mapping.variantId },
        'Product not found in orthonu_products — aborting. Run pnpm seed first.',
      );
      await pool.end();
      process.exit(1);
    }

    const { id: orthonuProductId, name: foundName } = productRows[0];

    await pool.query(
      `INSERT INTO dentira_variant_map
         (orthonu_product_id, dentira_variant_id, dentira_product_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (dentira_variant_id) WHERE dentira_variant_id IS NOT NULL DO UPDATE
         SET dentira_product_id = EXCLUDED.dentira_product_id,
             orthonu_product_id  = EXCLUDED.orthonu_product_id`,
      [orthonuProductId, mapping.variantId, mapping.productId],
    );

    // Remove any leftover NULL-variantId placeholder rows for this product
    // (seed-protocols.ts inserts these before real IDs are known)
    await pool.query(
      `DELETE FROM dentira_variant_map
       WHERE orthonu_product_id = $1 AND dentira_variant_id IS NULL`,
      [orthonuProductId],
    );

    logger.info(
      {
        orthonuProductId,
        name: foundName,
        dentiraVariantId: mapping.variantId,
        dentiraProductId: mapping.productId,
      },
      'Mapping applied',
    );
    applied++;
  }

  logger.info({ applied, total: VARIANT_MAPPING.length }, 'seed:variants complete');
  await pool.end();
}

seedVariants().catch(err => {
  logger.error({ err }, 'seed:variants failed');
  process.exit(1);
});
