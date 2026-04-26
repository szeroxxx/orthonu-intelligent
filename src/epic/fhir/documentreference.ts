import { createHash } from 'crypto';
import { fhirRequest } from './client.js';
import type { FhirDocumentReference } from '../types/fhir-r4.js';
import { LOINC_SYSTEM, PROGRESS_NOTE_LOINC } from '../types/fhir-r4.js';

export interface CreateDocumentReferenceOptions {
  fhirServer: string;
  patientId: string;
  encounterId?: string;
  practitionerId?: string;
  noteText: string;         // plain-text, pre-base64
  hookInstance: string;
  phraseIdsUsed: string[];
}

export interface CreateDocumentReferenceResult {
  documentReferenceId: string;
}

/**
 * Creates a FHIR R4 DocumentReference (Progress note, LOINC 11506-3) on Epic.
 * Uses If-None-Exist header for idempotency — retries will not create duplicates.
 */
export async function createDocumentReference(
  opts: CreateDocumentReferenceOptions,
): Promise<CreateDocumentReferenceResult> {
  const {
    fhirServer,
    patientId,
    encounterId,
    practitionerId,
    noteText,
    hookInstance,
    phraseIdsUsed,
  } = opts;

  const base64Data = Buffer.from(noteText, 'utf8').toString('base64');

  // Deterministic identifier for idempotency (If-None-Exist).
  const identifierValue = createHash('sha256')
    .update(`${hookInstance}:${phraseIdsUsed.join(',')}`)
    .digest('hex');

  const payload: FhirDocumentReference = {
    resourceType: 'DocumentReference',
    docStatus: 'final',
    type: {
      coding: [
        {
          system: LOINC_SYSTEM,
          code: PROGRESS_NOTE_LOINC,
          display: 'Progress note',
        },
      ],
      text: 'OrthoNu Clinical Protocol Note',
    },
    subject: { reference: `Patient/${patientId}` },
    date: new Date().toISOString(),
    ...(practitionerId
      ? { author: [{ reference: `Practitioner/${practitionerId}` }] }
      : {}),
    content: [
      {
        attachment: {
          contentType: 'text/plain',
          data: base64Data,
        },
      },
    ],
    ...(encounterId
      ? { context: { encounter: [{ reference: `Encounter/${encounterId}` }] } }
      : {}),
  };

  const resp = await fhirRequest<{ id?: string; resourceType?: string }>({
    fhirServer,
    method: 'POST',
    path: '/api/FHIR/R4/DocumentReference',
    body: payload,
    extraHeaders: {
      'If-None-Exist': `identifier=${identifierValue}`,
    },
  });

  // 201 Created — extract ID from Location header or response body.
  const location = resp.location;
  let documentReferenceId: string | undefined;

  if (location) {
    // Location: {fhirServer}/api/FHIR/R4/DocumentReference/{id}
    const match = location.match(/DocumentReference\/([^/]+)$/);
    if (match) documentReferenceId = match[1];
  }

  if (!documentReferenceId && resp.body?.id) {
    documentReferenceId = String(resp.body.id);
  }

  if (!documentReferenceId) {
    throw new Error(
      `DocumentReference created (status ${resp.status}) but no ID found in Location or body`,
    );
  }

  return { documentReferenceId };
}
