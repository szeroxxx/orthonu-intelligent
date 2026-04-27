import type { CdsServiceRequest } from '../types/cds-hooks.js';
import type { FhirCondition } from '../types/fhir-r4.js';
import type { DecisionResult } from './decision-engine.js';

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
}

// Terms that, when found in condition display text, indicate suppression.
// Per spec §6.4. Phase 2 should map these to ICD-10 ranges for precision.
const SUPPRESSION_TERMS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /complication/i, reason: 'complication_present' },
  { pattern: /infection/i, reason: 'infection_present' },
  { pattern: /uncontrolled\s+pain/i, reason: 'uncontrolled_pain' },
  { pattern: /persistent\s+lesion/i, reason: 'persistent_lesion' },
  { pattern: /supportive\s+product\s+not\s+appropriate/i, reason: 'product_not_appropriate' },
];

/**
 * Checks whether the hook request context indicates supportive-care cards
 * should be suppressed. Per spec §6.4.
 *
 * NOTE: the "already-declined in same encounter" check requires a DB query
 * which is handled separately by the hook handler after this call
 * (see hooks/order-select.ts and hooks/patient-view.ts).
 */
export function shouldSuppress(
  request: CdsServiceRequest,
  _matchResult: DecisionResult,
): SuppressionResult {
  const prefetch = request.prefetch as
    | Record<string, { resourceType: string; entry?: Array<{ resource?: FhirCondition }> }>
    | undefined;

  // Collect all conditions from problems and encounterDx
  const conditions: FhirCondition[] = [];

  for (const key of ['problems', 'encounterDx'] as const) {
    const bundle = prefetch?.[key];
    if (!bundle?.entry) continue;
    for (const e of bundle.entry) {
      if (e.resource?.resourceType === 'Condition') {
        conditions.push(e.resource as FhirCondition);
      }
    }
  }

  for (const condition of conditions) {
    const displayTexts = [
      ...(condition.code?.coding?.map(c => c.display ?? '') ?? []),
      condition.code?.text ?? '',
    ];

    for (const text of displayTexts) {
      for (const { pattern, reason } of SUPPRESSION_TERMS) {
        if (pattern.test(text)) {
          return { suppressed: true, reason };
        }
      }
    }
  }

  return { suppressed: false };
}
