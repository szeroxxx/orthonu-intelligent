import { pool } from '../../db/pool.js';
import type { FeedbackItem } from '../types/cds-hooks.js';

export interface FeedbackRow {
  id: number;
  hook_instance: string | null;
  card_uuid: string;
  outcome: string;
  override_reason_code: string | null;
  override_reason_text: string | null;
  accepted_suggestions: string[] | null;
  raw_feedback_jsonb: object;
  received_at: Date;
}

export async function insertFeedback(
  hookInstance: string | undefined,
  item: FeedbackItem,
  rawJson: object,
): Promise<FeedbackRow> {
  const overrideCode = item.overrideReasons?.[0]?.code ?? null;
  const overrideText = item.overrideReasons?.[0]?.display ?? null;
  const acceptedUuids =
    item.acceptedSuggestions?.map(s => s.id) ?? null;

  const { rows } = await pool.query<FeedbackRow>(
    `INSERT INTO epic_cds_feedback
       (hook_instance, card_uuid, outcome, override_reason_code,
        override_reason_text, accepted_suggestions, raw_feedback_jsonb)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      hookInstance ?? null,
      item.card,
      item.outcome,
      overrideCode,
      overrideText,
      acceptedUuids,
      JSON.stringify(rawJson),
    ],
  );
  return rows[0];
}

export async function getFeedbackById(id: number): Promise<FeedbackRow | null> {
  const { rows } = await pool.query<FeedbackRow>(
    `SELECT id, hook_instance, card_uuid, outcome, override_reason_code,
            override_reason_text, accepted_suggestions, raw_feedback_jsonb, received_at
     FROM epic_cds_feedback
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
