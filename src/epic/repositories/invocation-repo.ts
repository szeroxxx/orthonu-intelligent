import { pool } from '../../db/pool.js';

export interface InvocationInsert {
  hookInstance: string;
  hookType: string;
  serviceId: string;
  fhirServer: string;
  epicClientId: string;
  patientId?: string;
  userId?: string;
  encounterId?: string;
  cdtCode?: string;
  icd10Codes?: string[];
  matchedProtocolIds?: number[];
  cardCount: number;
  suppressed: boolean;
  suppressionReason?: string;
  responseTimeMs?: number;
}

export interface InvocationRow {
  id: number;
  hook_instance: string;
  hook_type: string;
  service_id: string;
  fhir_server: string;
  epic_client_id: string;
  patient_id: string | null;
  user_id: string | null;
  encounter_id: string | null;
  cdt_code: string | null;
  icd10_codes: string[] | null;
  matched_protocol_ids: number[] | null;
  card_count: number;
  suppressed: boolean;
  suppression_reason: string | null;
  response_time_ms: number | null;
  created_at: Date;
}

export async function insertInvocation(data: InvocationInsert): Promise<InvocationRow> {
  const { rows } = await pool.query<InvocationRow>(
    `INSERT INTO epic_hook_invocations
       (hook_instance, hook_type, service_id, fhir_server, epic_client_id,
        patient_id, user_id, encounter_id, cdt_code, icd10_codes,
        matched_protocol_ids, card_count, suppressed, suppression_reason, response_time_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      data.hookInstance,
      data.hookType,
      data.serviceId,
      data.fhirServer,
      data.epicClientId,
      data.patientId ?? null,
      data.userId ?? null,
      data.encounterId ?? null,
      data.cdtCode ?? null,
      data.icd10Codes ?? null,
      data.matchedProtocolIds ?? null,
      data.cardCount,
      data.suppressed,
      data.suppressionReason ?? null,
      data.responseTimeMs ?? null,
    ],
  );
  return rows[0];
}

export async function getInvocationByHookInstance(
  hookInstance: string,
): Promise<InvocationRow | null> {
  const { rows } = await pool.query<InvocationRow>(
    `SELECT id, hook_instance, hook_type, service_id, fhir_server, epic_client_id,
            patient_id, user_id, encounter_id, cdt_code, icd10_codes,
            matched_protocol_ids, card_count, suppressed, suppression_reason,
            response_time_ms, created_at
     FROM epic_hook_invocations
     WHERE hook_instance = $1`,
    [hookInstance],
  );
  return rows[0] ?? null;
}
