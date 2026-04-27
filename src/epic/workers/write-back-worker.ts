import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { getFeedbackById } from '../repositories/feedback-repo.js';
import { getInvocationByHookInstance } from '../repositories/invocation-repo.js';
import {
  insertDocumentReferenceWrite,
  updateDocumentReferenceStatus,
} from '../repositories/documentreference-repo.js';
import { getScenarioPhrasesByCdt, getScenarioPhrasesByIcd10 } from '../repositories/smartphrase-repo.js';
import { composeNote } from '../engine/note-composer.js';
import { createDocumentReference } from '../fhir/documentreference.js';
import type { PlaceholderContext } from '../types/smartphrase.js';

export interface WriteBackJobData {
  feedbackId: number;
}

export const WRITE_BACK_JOB_NAME = 'epic-documentreference-write';

/**
 * pg-boss worker: processes accepted CDS feedback and writes a DocumentReference
 * back to Epic's FHIR server.
 *
 * Retry policy (set at send-time): retryLimit=3, retryBackoff=true, retryDelay=60s.
 * 401/403 from Epic → token cache is cleared by fhir/client.ts; pg-boss retries.
 */
export async function writeBackWorker(job: PgBoss.Job<WriteBackJobData>): Promise<void> {
  const { feedbackId } = job.data;

  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) {
    logger.error({ feedbackId }, 'Write-back job: feedback row not found');
    return;
  }

  const hookInstance = feedback.hook_instance;
  if (!hookInstance) {
    logger.warn({ feedbackId }, 'Write-back job: hook_instance is null — cannot write-back');
    return;
  }

  const invocation = await getInvocationByHookInstance(hookInstance);
  if (!invocation) {
    logger.error({ hookInstance }, 'Write-back job: invocation not found');
    return;
  }

  if (!invocation.patient_id) {
    logger.warn({ hookInstance }, 'Write-back job: patient_id missing on invocation');
    return;
  }

  // Determine the scenario phrase to recompose the note.
  let scenarioPhrases: Awaited<ReturnType<typeof getScenarioPhrasesByCdt>> = [];
  if (invocation.cdt_code) {
    scenarioPhrases = await getScenarioPhrasesByCdt(invocation.cdt_code);
  } else if (invocation.icd10_codes?.length) {
    scenarioPhrases = await getScenarioPhrasesByIcd10(invocation.icd10_codes[0]);
  }

  if (scenarioPhrases.length === 0) {
    logger.warn({ hookInstance }, 'Write-back job: no scenario phrases found — skipping');
    return;
  }

  const scenarioPhrase = scenarioPhrases[0];

  const ctx: PlaceholderContext = {
    cdtCode: invocation.cdt_code ?? undefined,
    icd10Code: invocation.icd10_codes?.[0] ?? undefined,
    patientDecision: 'accepted',
  };

  const { noteText, phraseIdsUsed } = await composeNote({
    scenarioPhrase,
    context: ctx,
    patientDecision: 'accepted',
  });

  // Create the write-back audit row before the FHIR call.
  const writeRow = await insertDocumentReferenceWrite({
    hookInstance,
    fhirServer: invocation.fhir_server,
    patientId: invocation.patient_id,
    encounterId: invocation.encounter_id ?? undefined,
    practitionerId: invocation.user_id?.replace('Practitioner/', '') ?? undefined,
    composedNoteText: noteText,
    phraseIdsUsed,
  });

  try {
    const result = await createDocumentReference({
      fhirServer: invocation.fhir_server,
      patientId: invocation.patient_id,
      encounterId: invocation.encounter_id ?? undefined,
      practitionerId: invocation.user_id?.replace('Practitioner/', '') ?? undefined,
      noteText,
      hookInstance,
      phraseIdsUsed,
    });

    await updateDocumentReferenceStatus(writeRow.id, 'succeeded', result.documentReferenceId);

    logger.info(
      {
        hookInstance,
        documentReferenceId: result.documentReferenceId,
        phraseCount: phraseIdsUsed.length,
      },
      'DocumentReference write-back succeeded',
    );
  } catch (err: unknown) {
    const msg = (err as Error).message ?? 'unknown error';
    await updateDocumentReferenceStatus(writeRow.id, 'failed', undefined, msg);

    // Re-throw so pg-boss can apply retry logic.
    throw err;
  }
}

/** Registers the write-back worker with the pg-boss instance. */
export async function registerWriteBackWorker(boss: PgBoss): Promise<void> {
  await boss.work<WriteBackJobData>(
    WRITE_BACK_JOB_NAME,
    { teamSize: 5, teamConcurrency: 2 },
    async job => writeBackWorker(job),
  );
  logger.info('Epic write-back worker registered');
}
