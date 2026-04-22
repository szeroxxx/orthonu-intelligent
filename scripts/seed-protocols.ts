/**
 * Reads OrthoNu_Clinical_Protocol_Master_Chart.xlsx from the context folder,
 * maps columns to the DB schema, and upserts all records.
 * Also seeds the 7 OrthoNu products and placeholder dentira_variant_map rows.
 *
 * Run: pnpm seed
 */
import 'dotenv/config';
import path from 'path';
import * as XLSX from 'xlsx';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/lib/logger.js';

const XLSX_PATH = path.resolve(
  process.cwd(),
  'context',
  'OrthoNu_Clinical_Protocol_Master_Chart.xlsx',
);

// ── 7 OrthoNu products from the transcript + POC spec ─────────────────────────
const PRODUCTS = [
  {
    name: 'Braces Starter Collection',
    sku: 'SKU-ON-1001',
    msrp_cents: 18999,
    dso_price_cents: 11000,
    dissolvable: false,
    category: 'Orthodontics',
    description: 'Complete starter kit for braces patients including wax, relief gel, and care essentials',
  },
  {
    name: 'Aligner Starter Collection',
    sku: 'SKU-ON-1002',
    msrp_cents: 18999,
    dso_price_cents: 11000,
    dissolvable: false,
    category: 'Orthodontics',
    description: 'Complete care kit for clear aligner patients with cleaning and comfort solutions',
  },
  {
    name: 'Comfort Tape',
    sku: 'SKU-ON-1003',
    msrp_cents: 2499,
    dso_price_cents: 1500,
    dissolvable: false,
    category: 'Orthodontics',
    description: 'Medical-grade silicone tape for bracket and wire irritation relief',
  },
  {
    name: 'Chillin Strips',
    sku: 'SKU-ON-1004',
    msrp_cents: 2499,
    dso_price_cents: 1500,
    dissolvable: true,
    category: 'Oral Care',
    description: 'Dissolvable oral comfort strips for post-operative pain management',
  },
  {
    name: 'Oral Relief Kit',
    sku: 'SKU-ON-1005',
    msrp_cents: 9899,
    dso_price_cents: 6000,
    dissolvable: false,
    category: 'General Dentistry',
    description: 'Comprehensive oral relief kit for general dental procedures',
  },
  {
    name: 'Mouth-Aid',
    sku: 'SKU-ON-1006',
    msrp_cents: 2499,
    dso_price_cents: 1500,
    dissolvable: false,
    category: 'Oral Medicine',
    description: 'Topical aid for oral mucosal conditions and ulcer management',
  },
  {
    name: 'OrthoChewz',
    sku: 'SKU-ON-1007',
    msrp_cents: 2499,
    dso_price_cents: 1500,
    dissolvable: false,
    category: 'Oral Medicine',
    description: 'Chewable oral care supplement for oral microbiome support',
  },
] as const;

// Placeholder Dentira variantIds — to be confirmed by Deepankar.
// Using V20010 / V10010 as examples from the API spec; real IDs TBD.
const PLACEHOLDER_VARIANT_MAP: Record<string, string | null> = {
  'SKU-ON-1001': null, // Braces Starter — awaiting variantId from Deepankar
  'SKU-ON-1002': null, // Aligner Starter — awaiting variantId
  'SKU-ON-1003': null, // Comfort Tape — awaiting variantId
  'SKU-ON-1004': null, // Chillin Strips — awaiting variantId
  'SKU-ON-1005': null, // Oral Relief Kit — awaiting variantId
  'SKU-ON-1006': null, // Mouth-Aid — awaiting variantId
  'SKU-ON-1007': null, // OrthoChewz — awaiting variantId
};

// Map POC CDT schema specialty strings to canonical specialty names
const SPECIALTY_MAP: Record<string, string> = {
  ortho: 'Orthodontics',
  perio: 'Periodontics',
  endo: 'Endodontics',
  oralsurg: 'Oral Surgery',
  oralmed: 'Oral Medicine',
  implant: 'Implant Dentistry',
  gendent: 'General Dentistry',
};

function normalizeSpecialty(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return SPECIALTY_MAP[key] ?? raw;
}

// Column mapping for the xlsx — tries multiple possible header names
function getCell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  return '';
}

async function seed() {
  logger.info('Starting seed...');

  // ── 1. Seed products ──────────────────────────────────────────────────────
  logger.info('Seeding orthonu_products...');
  const productIdMap = new Map<string, number>(); // sku → db id

  for (const p of PRODUCTS) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO orthonu_products
         (name, sku, msrp_cents, dso_price_cents, dissolvable, category, description, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (sku) DO UPDATE
         SET name=EXCLUDED.name, msrp_cents=EXCLUDED.msrp_cents,
             dso_price_cents=EXCLUDED.dso_price_cents, description=EXCLUDED.description,
             active=TRUE
       RETURNING id`,
      [p.name, p.sku, p.msrp_cents, p.dso_price_cents, p.dissolvable, p.category, p.description],
    );
    productIdMap.set(p.sku, rows[0].id);
    logger.info({ sku: p.sku, id: rows[0].id }, 'Product upserted');
  }

  // ── 2. Seed dentira_variant_map placeholder rows ──────────────────────────
  logger.info('Seeding dentira_variant_map placeholder rows...');
  for (const [sku, variantId] of Object.entries(PLACEHOLDER_VARIANT_MAP)) {
    const productId = productIdMap.get(sku);
    if (!productId) continue;

    // Only insert if no row exists for this product yet
    await pool.query(
      `INSERT INTO dentira_variant_map (orthonu_product_id, dentira_variant_id)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM dentira_variant_map WHERE orthonu_product_id = $1
       )`,
      [productId, variantId],
    );
  }

  // ── 3. Seed protocols from xlsx ───────────────────────────────────────────
  logger.info({ path: XLSX_PATH }, 'Reading xlsx...');

  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.readFile(XLSX_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
  } catch (err) {
    // If xlsx is not accessible, fall back to the POC's JSON data
    logger.warn({ err }, 'Could not read xlsx — falling back to POC cdt-mapping-schema.json');
    const pocDataPath = path.resolve(process.cwd(), '..', 'orthonu-poc', 'data', 'cdt-mapping-schema.json');
    const fs = await import('fs');
    const raw = fs.readFileSync(pocDataPath, 'utf8');
    rows = JSON.parse(raw) as Record<string, unknown>[];
  }

  logger.info({ rowCount: rows.length }, 'Rows loaded, upserting protocols...');
  let inserted = 0;

  for (const row of rows) {
    const cdtCode = getCell(row, 'cdt_code', 'CDT Code', 'CDT_CODE', 'CDT', 'Code');
    const diagnosis = getCell(row, 'diagnosis_label', 'Diagnosis', 'diagnosis', 'Description');
    const specialty = normalizeSpecialty(getCell(row, 'specialty', 'Specialty', 'SPECIALTY'));
    const productName = getCell(row, 'orthonu_product_name', 'Product', 'product_name', 'OrthoNu Product');
    const icd10 = getCell(row, 'icd10', 'ICD10', 'icd10_code', 'ICD-10');
    const confidence = parseInt(getCell(row, 'confidence_score', 'confidence_pct', 'Confidence', 'Score') || '0', 10);
    const triggerCondition = getCell(row, 'application_context', 'trigger_condition', 'Trigger');
    const applicationNotes = getCell(row, 'application_context', 'application_notes', 'Application');
    const followUp = getCell(row, 'follow_up_protocol', 'Follow Up', 'follow_up');

    if (!cdtCode || !productName) continue;

    // Find product id by name
    const productEntry = PRODUCTS.find(
      p => p.name.toLowerCase() === productName.toLowerCase(),
    );
    if (!productEntry) {
      logger.warn({ productName, cdtCode }, 'Unknown product name in xlsx — skipping row');
      continue;
    }
    const productId = productIdMap.get(productEntry.sku);
    if (!productId) continue;

    await pool.query(
      `INSERT INTO protocols
         (cdt_code, diagnosis, specialty, orthonu_product_id,
          icd10_code, confidence_pct, trigger_condition, application_notes, follow_up_protocol)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [cdtCode, diagnosis || `CDT ${cdtCode}`, specialty, productId,
       icd10 || null, isNaN(confidence) ? null : confidence,
       triggerCondition || null, applicationNotes || null, followUp || null],
    );
    inserted++;
  }

  logger.info({ inserted }, 'Protocol seed complete');
  await pool.end();
}

seed().catch(err => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
