import { pool } from '../../db/pool.js';

export interface DocumentReferenceInsert {
  hookInstance: string;
  fhirServer: string;
  patientId: string;
  encounterId?: string;
  practitionerId?: string;
  composedNoteText: string;
  phraseIdsUsed: string[];
}

export interface DocumentReferenceRow {
  id: number;
  hook_instance: string;
  fhir_server: string;
  patient_id: string;
  encounter_id: string | null;
  practitioner_id: string | null;
  composed_note_text: string;
  phrase_ids_used: string[];
  epic_documentreference_id: string | null;
  status: string;
  error_message: string | null;
  attempted_at: Date;
  completed_at: Date | null;
}

export async function insertDocumentReferenceWrite(
  data: DocumentReferenceInsert,
): Promise<DocumentReferenceRow> {
  const { rows } = await pool.query<DocumentReferenceRow>(
    `INSERT INTO epic_documentreference_writes
       (hook_instance, fhir_server, patient_id, encounter_id, practitioner_id,
        composed_note_text, phrase_ids_used, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     RETURNING *`,
    [
      data.hookInstance,
      data.fhirServer,
      data.patientId,
      data.encounterId ?? null,
      data.practitionerId ?? null,
      data.composedNoteText,
      data.phraseIdsUsed,
    ],
  );
  return rows[0];
}

export async function updateDocumentReferenceStatus(
  id: number,
  status: 'succeeded' | 'failed',
  epicDocumentReferenceId?: string,
  errorMessage?: string,
): Promise<void> {
  await pool.query(
    `UPDATE epic_documentreference_writes
     SET status = $2,
         epic_documentreference_id = $3,
         error_message = $4,
         completed_at = NOW()
     WHERE id = $1`,
    [id, status, epicDocumentReferenceId ?? null, errorMessage ?? null],
  );
}

export async function getDocumentReferenceById(id: number): Promise<DocumentReferenceRow | null> {
  const { rows } = await pool.query<DocumentReferenceRow>(
    `SELECT id, hook_instance, fhir_server, patient_id, encounter_id, practitioner_id,
            composed_note_text, phrase_ids_used, epic_documentreference_id,
            status, error_message, attempted_at, completed_at
     FROM epic_documentreference_writes
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
