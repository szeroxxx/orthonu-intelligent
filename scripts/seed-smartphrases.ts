/**
 * Seed script: populates epic_smartphrases from OrthoNu_SmartPhrase_Build_Package_SSD.xlsx.
 * Run: pnpm epic:seed
 *
 * Idempotent — uses ON CONFLICT (phrase_id) DO UPDATE.
 * Reads Sheet 2 (SmartPhrase Library) and cross-references Sheet 3 (Protocol Trigger Matrix).
 */
import 'dotenv/config';
import * as xlsx from 'xlsx';
import path from 'path';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/lib/logger.js';

const XLSX_PATH = path.resolve(
  process.cwd(),
  'context/epic cds/OrthoNu_SmartPhrase_Build_Package_SSD.xlsx',
);

const EXPECTED_PHRASE_COUNT = 42;

// Known placeholder tokens per spec §5.3.
const KNOWN_TOKENS = new Set([
  'SYMPTOMS', 'CLINICAL_FINDINGS', 'CDT_CODE', 'PROCEDURE_DESCRIPTION',
  'ICD10_CODE', 'DIAGNOSIS_DESCRIPTION', 'PATIENT_DECISION', 'CLINICAL_CONTEXT',
  'CLINICAL_ISSUE', 'RESPONSE_TO_PRODUCT_OR_PLAN',
]);

const TOKEN_RE = /\{([A-Z_]+)\}/g;

// CDT range expander: "D8010-D8090" → ["D8010","D8020",...,"D8090"]
function expandCdtRange(rangeStr: string): string[] {
  const match = rangeStr.trim().match(/^(D)(\d{4})-(D\d{4})$/i);
  if (!match) return [rangeStr.trim()];
  const prefix = match[1].toUpperCase();
  const start = parseInt(match[2], 10);
  const endMatch = match[3].match(/\d+/);
  if (!endMatch) return [rangeStr.trim()];
  const end = parseInt(endMatch[0], 10);
  const codes: string[] = [];
  for (let i = start; i <= end; i += 10) {
    codes.push(`${prefix}${String(i).padStart(4, '0')}`);
  }
  return codes;
}

function parseCdtCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  const codes: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      codes.push(...expandCdtRange(trimmed));
    } else {
      codes.push(trimmed.toUpperCase());
    }
  }
  return [...new Set(codes)];
}

function extractPlaceholders(text: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    tokens.push(m[1]);
  }
  return [...new Set(tokens)];
}

// Normalize dot-separated phrase IDs (handles underscore variants)
function normalizeId(id: string): string {
  return id.trim().replace(/_/g, '.').toUpperCase();
}

// Normalize product name for matching (strip apostrophes, lowercase)
function normalizeProductName(name: string): string {
  return name.replace(/['']/g, '').toLowerCase().trim();
}

// Column header fuzzy match
function findCol(row: Record<string, unknown>, ...candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const found = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

function cellStr(row: Record<string, unknown>, col: string | undefined): string {
  if (!col) return '';
  const v = row[col];
  if (v == null) return '';
  return String(v).trim();
}

async function getProductIdMap(): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM orthonu_products WHERE active = TRUE',
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(normalizeProductName(r.name), r.id);
  }
  return map;
}

async function main(): Promise<void> {
  logger.info({ path: XLSX_PATH }, 'Loading SmartPhrase xlsx');

  let workbook: xlsx.WorkBook;
  try {
    workbook = xlsx.readFile(XLSX_PATH);
  } catch (err) {
    logger.error({ err, path: XLSX_PATH }, 'Cannot open xlsx file');
    process.exit(1);
  }

  const sheetNames = workbook.SheetNames;
  logger.info({ sheetNames }, 'Sheets found in workbook');

  // Sheet 2 = SmartPhrase Library (index 1)
  const phraseSheetName = sheetNames[1] ?? 'SmartPhrase Library';
  // Sheet 3 = Protocol Trigger Matrix (index 2)
  const triggerSheetName = sheetNames[2] ?? 'Protocol Trigger Matrix';

  const phraseSheet = workbook.Sheets[phraseSheetName];
  const triggerSheet = workbook.Sheets[triggerSheetName];

  if (!phraseSheet) {
    logger.error({ phraseSheetName }, 'SmartPhrase Library sheet not found');
    process.exit(1);
  }

  const phraseRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(phraseSheet, { defval: '' });
  const triggerRows = triggerSheet
    ? xlsx.utils.sheet_to_json<Record<string, unknown>>(triggerSheet, { defval: '' })
    : [];

  logger.info({ phraseCount: phraseRows.length, triggerCount: triggerRows.length }, 'Rows parsed');

  // Build trigger map: phraseId → { cdtCodes, icd10Codes }
  const triggerMap = new Map<string, { cdtCodes: string[]; icd10Codes: string[] }>();
  for (const row of triggerRows) {
    const idCol = findCol(row, 'Phrase ID', 'Scenario Phrase', 'phrase_id', 'ID');
    const cdtCol = findCol(row, 'CDT Code(s)', 'CDT Codes', 'CDT Code', 'cdt_codes');
    const cdtRangeCol = findCol(row, 'CDT Range', 'CDT range');
    const icd10Col = findCol(row, 'ICD-10 Code', 'ICD10 Code', 'ICD-10', 'icd10_code');

    const rawId = cellStr(row, idCol);
    if (!rawId) continue;
    const phraseId = normalizeId(rawId);

    const cdtRaw = cellStr(row, cdtCol);
    const cdtRangeRaw = cellStr(row, cdtRangeCol);
    const icd10Raw = cellStr(row, icd10Col);

    const cdtCodes = [...parseCdtCodes(cdtRaw), ...parseCdtCodes(cdtRangeRaw)];
    const icd10Codes = icd10Raw ? icd10Raw.split(',').map(c => c.trim()).filter(Boolean) : [];

    const existing = triggerMap.get(phraseId);
    if (existing) {
      existing.cdtCodes.push(...cdtCodes);
      existing.icd10Codes.push(...icd10Codes);
    } else {
      triggerMap.set(phraseId, { cdtCodes, icd10Codes });
    }
  }

  const productIdMap = await getProductIdMap();

  // Category counts
  const counts: Record<string, number> = {};
  let inserted = 0;
  const warnings: string[] = [];
  const unknownPhraseIds: string[] = [];

  for (const row of phraseRows) {
    const idCol = findCol(row, 'Phrase ID', 'ID', 'phrase_id');
    const catCol = findCol(row, 'Category', 'category');
    const titleCol = findCol(row, 'Title', 'Name', 'title', 'name');
    const bodyCol = findCol(row, 'Phrase Text', 'Body', 'Content', 'body_markdown', 'Phrase Body', 'Text');
    const productCol = findCol(row, 'Product', 'Product Name', 'product');

    const rawId = cellStr(row, idCol);
    if (!rawId) {
      warnings.push('Row missing Phrase ID — skipped');
      continue;
    }

    const phraseId = normalizeId(rawId);
    const category = cellStr(row, catCol) || 'Core';
    const title = cellStr(row, titleCol) || phraseId;
    const body = cellStr(row, bodyCol) || '';
    const productName = cellStr(row, productCol);

    if (!body) {
      warnings.push(`${phraseId}: empty body — inserting with placeholder`);
    }

    const placeholders = extractPlaceholders(body);
    for (const t of placeholders) {
      if (!KNOWN_TOKENS.has(t)) {
        logger.warn({ token: t, phraseId }, 'Unknown placeholder token in phrase body');
      }
    }

    // Resolve product ID
    let orthonuProductId: number | null = null;
    if (productName) {
      const normalized = normalizeProductName(productName);
      const found = productIdMap.get(normalized);
      if (found) {
        orthonuProductId = found;
      } else {
        logger.info({ productName, phraseId }, 'Product not in orthonu_products — orthonu_product_id will be NULL');
      }
    }

    // CDT/ICD10 from trigger map
    const trigger = triggerMap.get(phraseId);
    const cdtCodes = trigger?.cdtCodes.length ? [...new Set(trigger.cdtCodes)] : null;
    const icd10Codes = trigger?.icd10Codes.length ? [...new Set(trigger.icd10Codes)] : null;

    await pool.query(
      `INSERT INTO epic_smartphrases
         (phrase_id, category, title, body_markdown, placeholder_tokens,
          cdt_codes, icd10_codes, orthonu_product_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (phrase_id)
       DO UPDATE SET
         category           = EXCLUDED.category,
         title              = EXCLUDED.title,
         body_markdown      = EXCLUDED.body_markdown,
         placeholder_tokens = EXCLUDED.placeholder_tokens,
         cdt_codes          = EXCLUDED.cdt_codes,
         icd10_codes        = EXCLUDED.icd10_codes,
         orthonu_product_id = EXCLUDED.orthonu_product_id`,
      [phraseId, category, title, body, placeholders, cdtCodes, icd10Codes, orthonuProductId],
    );

    counts[category] = (counts[category] ?? 0) + 1;
    inserted++;
  }

  // Check for trigger matrix IDs not found in phrase sheet
  for (const triggerId of triggerMap.keys()) {
    const found = phraseRows.some(r => {
      const idCol = findCol(r, 'Phrase ID', 'ID', 'phrase_id');
      return normalizeId(cellStr(r, idCol)) === triggerId;
    });
    if (!found) unknownPhraseIds.push(triggerId);
  }

  if (unknownPhraseIds.length > 0) {
    logger.warn({ unknownPhraseIds }, 'Phrase IDs in trigger matrix have no match in SmartPhrase Library');
  }

  for (const w of warnings) logger.warn(w);

  logger.info({ inserted, counts }, 'SmartPhrase seed complete');

  if (inserted !== EXPECTED_PHRASE_COUNT) {
    logger.warn(
      { inserted, expected: EXPECTED_PHRASE_COUNT },
      `Phrase count mismatch — expected ${EXPECTED_PHRASE_COUNT}, got ${inserted}`,
    );
  }

  // Validation query
  const { rows: catCounts } = await pool.query<{ category: string; count: string }>(
    'SELECT category, COUNT(*)::int as count FROM epic_smartphrases GROUP BY category ORDER BY category',
  );
  logger.info({ categoryBreakdown: catCounts }, 'Category breakdown after seed');

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  logger.fatal({ err }, 'Seed script failed');
  process.exit(1);
});
