// Condition resource builder — Epic creates Conditions via suggestion acceptance.
// We only structure the FHIR resource payload here; we do not POST it directly.
// (Epic handles Condition.Create when the clinician accepts the suggestion.)

import type { FhirCondition } from '../types/fhir-r4.js';
import { ICD10_OID, CONDITION_CATEGORY_SYSTEM } from '../types/fhir-r4.js';

export interface ConditionResourceOptions {
  patientId: string;
  encounterId?: string;
  icd10Code: string;
  display: string;
}

/** Builds a FHIR R4 Condition resource for use in CDS Hooks suggestions. */
export function buildConditionResource(opts: ConditionResourceOptions): FhirCondition {
  return {
    resourceType: 'Condition',
    category: [
      {
        coding: [
          {
            system: CONDITION_CATEGORY_SYSTEM,
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: ICD10_OID,
          code: opts.icd10Code,
          display: opts.display,
        },
      ],
      text: opts.display,
    },
    subject: { reference: `Patient/${opts.patientId}` },
    ...(opts.encounterId
      ? { encounter: { reference: `Encounter/${opts.encounterId}` } }
      : {}),
  };
}
