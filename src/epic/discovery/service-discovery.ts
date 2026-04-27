import type { Request, Response } from 'express';
import type { CdsServicesResponse } from '../types/cds-hooks.js';

// Discovery endpoint — no auth required per CDS Hooks 1.0 spec.
// Prefetch templates use Epic FHIR R4 path notation.
export function serviceDiscoveryHandler(_req: Request, res: Response): void {
  const body: CdsServicesResponse = {
    services: [
      {
        hook: 'patient-view',
        title: 'OrthoNu Oral Intelligence',
        description:
          'Diagnosis and symptom-driven oral care decision support for supportive dental products.',
        id: 'orthonu-oral-intelligence',
        prefetch: {
          patient: 'Patient/{{context.patientId}}',
          problems:
            'Condition?patient={{context.patientId}}&clinical-status=active&category=problem-list-item',
          encounterDx:
            'Condition?patient={{context.patientId}}&encounter={{context.encounterId}}&category=encounter-diagnosis',
        },
      },
      {
        hook: 'order-select',
        title: 'OrthoNu Protocol Engine',
        description:
          'CDT code-driven supportive product recommendations with ICD-10 symptom confirmation.',
        id: 'orthonu-protocol-engine',
        prefetch: {
          patient: 'Patient/{{context.patientId}}',
          problems:
            'Condition?patient={{context.patientId}}&clinical-status=active&category=problem-list-item',
        },
      },
    ],
  };

  res.json(body);
}
