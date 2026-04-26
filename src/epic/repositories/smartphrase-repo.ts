import { pool } from '../../db/pool.js';
import type { SmartPhrase } from '../types/smartphrase.js';

// Read-only access to epic_smartphrases. All lookups are by phrase_id or array membership.

export async function getPhraseById(phraseId: string): Promise<SmartPhrase | null> {
  const { rows } = await pool.query<SmartPhrase>(
    `SELECT id, phrase_id, category, title, body_markdown, placeholder_tokens,
            cdt_codes, icd10_codes, orthonu_product_id, active
     FROM epic_smartphrases
     WHERE phrase_id = $1 AND active = TRUE`,
    [phraseId],
  );
  return rows[0] ?? null;
}

export async function getPhrasesByIds(phraseIds: string[]): Promise<SmartPhrase[]> {
  if (phraseIds.length === 0) return [];
  const { rows } = await pool.query<SmartPhrase>(
    `SELECT id, phrase_id, category, title, body_markdown, placeholder_tokens,
            cdt_codes, icd10_codes, orthonu_product_id, active
     FROM epic_smartphrases
     WHERE phrase_id = ANY($1) AND active = TRUE
     ORDER BY id`,
    [phraseIds],
  );
  return rows;
}

/** Scenario phrases whose cdt_codes array contains the given CDT code. */
export async function getScenarioPhrasesByCdt(cdtCode: string): Promise<SmartPhrase[]> {
  const { rows } = await pool.query<SmartPhrase>(
    `SELECT id, phrase_id, category, title, body_markdown, placeholder_tokens,
            cdt_codes, icd10_codes, orthonu_product_id, active
     FROM epic_smartphrases
     WHERE category = 'Scenario' AND active = TRUE AND $1 = ANY(cdt_codes)
     ORDER BY id`,
    [cdtCode],
  );
  return rows;
}

/** Scenario/Diagnosis phrases whose icd10_codes array contains the given ICD-10 code. */
export async function getScenarioPhrasesByIcd10(icd10Code: string): Promise<SmartPhrase[]> {
  const { rows } = await pool.query<SmartPhrase>(
    `SELECT id, phrase_id, category, title, body_markdown, placeholder_tokens,
            cdt_codes, icd10_codes, orthonu_product_id, active
     FROM epic_smartphrases
     WHERE category IN ('Scenario','Diagnosis') AND active = TRUE
           AND $1 = ANY(icd10_codes)
     ORDER BY id`,
    [icd10Code],
  );
  return rows;
}
