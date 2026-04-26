import { describe, it, expect } from 'vitest';
import { shouldSuppress } from './suppression.js';

function makeRequest(conditions: Array<{ display: string; category?: string }>) {
  return {
    hookInstance: 'aaa',
    fhirServer: 'https://fhir.epic.com',
    hook: 'order-select',
    context: { patientId: 'P1' },
    prefetch: {
      problems: {
        resourceType: 'Bundle',
        entry: conditions.map(c => ({
          resource: {
            resourceType: 'Condition',
            category: [
              {
                coding: [
                  { code: c.category ?? 'problem-list-item' },
                ],
              },
            ],
            code: {
              coding: [{ display: c.display }],
            },
          },
        })),
      },
    },
  };
}

const noMatch = { type: 'no-match' as const };

describe('suppression', () => {
  it('"complication" in problems → suppressed', () => {
    const req = makeRequest([{ display: 'Post-operative complication of dental procedure' }]);
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('complication_present');
  });

  it('"infection" in encounter diagnosis → suppressed', () => {
    const req = {
      hookInstance: 'bbb',
      fhirServer: 'https://fhir.epic.com',
      hook: 'patient-view',
      context: { patientId: 'P2' },
      prefetch: {
        encounterDx: {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Condition',
                code: { coding: [{ display: 'Oral infection of unknown etiology' }] },
              },
            },
          ],
        },
        problems: { resourceType: 'Bundle', entry: [] },
      },
    };
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('infection_present');
  });

  it('"uncontrolled pain" in problems → suppressed', () => {
    const req = makeRequest([{ display: 'Uncontrolled pain following extraction' }]);
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('uncontrolled_pain');
  });

  it('"persistent lesion" in problems → suppressed', () => {
    const req = makeRequest([{ display: 'Persistent lesion of oral mucosa' }]);
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('persistent_lesion');
  });

  it('Normal chronic periodontitis → not suppressed', () => {
    const req = makeRequest([{ display: 'Chronic periodontitis, unspecified' }]);
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(false);
  });

  it('Empty problems list → not suppressed', () => {
    const req = makeRequest([]);
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(false);
  });

  it('Missing prefetch → not suppressed', () => {
    const req = {
      hookInstance: 'ccc',
      fhirServer: 'https://fhir.epic.com',
      hook: 'order-select',
      context: { patientId: 'P3' },
    };
    const result = shouldSuppress(req as never, noMatch);
    expect(result.suppressed).toBe(false);
  });
});
