import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the protocol service and smartphrase repo before importing the engine.
vi.mock('../../protocols/service.js', () => ({
  getProtocolByCdt: vi.fn(),
  getProtocolsByIcd10: vi.fn(),
}));
vi.mock('../repositories/smartphrase-repo.js', () => ({
  getScenarioPhrasesByCdt: vi.fn(),
  getScenarioPhrasesByIcd10: vi.fn(),
}));

import { evaluate, _flushProtocolCache } from './decision-engine.js';
import { getProtocolByCdt, getProtocolsByIcd10 } from '../../protocols/service.js';
import {
  getScenarioPhrasesByCdt,
  getScenarioPhrasesByIcd10,
} from '../repositories/smartphrase-repo.js';
import type { ProtocolWithProduct } from '../../protocols/service.js';
import type { SmartPhrase } from '../types/smartphrase.js';

const mockGetProtocolByCdt = vi.mocked(getProtocolByCdt);
const mockGetProtocolsByIcd10 = vi.mocked(getProtocolsByIcd10);
const mockGetScenarioByCdt = vi.mocked(getScenarioPhrasesByCdt);
const mockGetScenarioByIcd10 = vi.mocked(getScenarioPhrasesByIcd10);

const PERIO_PROTOCOL: ProtocolWithProduct = {
  id: 1,
  cdt_code: 'D4341',
  diagnosis: 'Chronic periodontitis',
  specialty: 'Periodontics',
  icd10_code: 'K05.30',
  confidence_pct: 90,
  trigger_condition: 'Active periodontal disease',
  application_notes: null,
  follow_up_protocol: null,
  product: {
    id: 1,
    name: "Chillin Strips",
    sku: 'CHILL-001',
    msrp_cents: 1999,
    dso_price_cents: null,
    dissolvable: true,
    category: 'Periodontal',
    description: null,
  },
  dentira_variant_id: null,
};

const PERIO_PHRASE: SmartPhrase = {
  id: 10,
  phrase_id: 'SCENARIO.PERIO.CHILLIN',
  category: 'Scenario',
  title: 'Post-Periodontal Comfort Support',
  body_markdown: 'Patient presents with {SYMPTOMS}. CDT {CDT_CODE} performed.',
  placeholder_tokens: ['SYMPTOMS', 'CDT_CODE'],
  cdt_codes: ['D4341', 'D4210'],
  icd10_codes: ['K05.30'],
  orthonu_product_id: 1,
  active: true,
};

function makeOrderSelectRequest(cdtCode: string, problemIcd10Codes: string[] = []) {
  return {
    hookInstance: '11111111-1111-1111-1111-111111111111',
    fhirServer: 'https://fhir.epic.com',
    hook: 'order-select',
    context: {
      patientId: 'PATIENT-1',
      encounterId: 'ENC-1',
      draftOrders: {
        resourceType: 'Bundle' as const,
        entry: [
          {
            resource: {
              resourceType: 'ServiceRequest',
              code: {
                coding: [
                  { system: 'urn:oid:2.16.840.1.113883.6.13', code: cdtCode },
                ],
              },
            },
          },
        ],
      },
    },
    prefetch: {
      problems: {
        resourceType: 'Bundle',
        entry: problemIcd10Codes.map(code => ({
          resource: {
            resourceType: 'Condition',
            code: {
              coding: [{ system: 'urn:oid:2.16.840.1.113883.6.90', code }],
            },
          },
        })),
      },
    },
  };
}

function makePatientViewRequest(encounterDxIcd10: string[], problemIcd10: string[] = []) {
  return {
    hookInstance: '22222222-2222-2222-2222-222222222222',
    fhirServer: 'https://fhir.epic.com',
    hook: 'patient-view',
    context: { patientId: 'PATIENT-2', encounterId: 'ENC-2' },
    prefetch: {
      encounterDx: {
        resourceType: 'Bundle',
        entry: encounterDxIcd10.map(code => ({
          resource: {
            resourceType: 'Condition',
            code: {
              coding: [{ system: 'urn:oid:2.16.840.1.113883.6.90', code }],
            },
          },
        })),
      },
      problems: {
        resourceType: 'Bundle',
        entry: problemIcd10.map(code => ({
          resource: {
            resourceType: 'Condition',
            code: {
              coding: [{ system: 'urn:oid:2.16.840.1.113883.6.90', code }],
            },
          },
        })),
      },
    },
  };
}

beforeEach(() => {
  _flushProtocolCache();
  vi.clearAllMocks();
});

describe('order-select: D4341', () => {
  it('D4341 with no matching ICD-10 in problems → passive', async () => {
    mockGetProtocolByCdt.mockResolvedValue([PERIO_PROTOCOL]);
    mockGetScenarioByCdt.mockResolvedValue([PERIO_PHRASE]);

    const result = await evaluate(makeOrderSelectRequest('D4341', []) as never, 'order-select');

    expect(result.type).toBe('passive');
    if (result.type === 'passive') {
      expect(result.cdtCode).toBe('D4341');
    }
  });

  it('D4341 + K05.30 in problems → scenario match (SCENARIO.PERIO.CHILLIN)', async () => {
    mockGetProtocolByCdt.mockResolvedValue([PERIO_PROTOCOL]);
    mockGetScenarioByCdt.mockResolvedValue([PERIO_PHRASE]);

    const result = await evaluate(
      makeOrderSelectRequest('D4341', ['K05.30']) as never,
      'order-select',
    );

    expect(result.type).toBe('match');
    if (result.type === 'match') {
      expect(result.cdtCode).toBe('D4341');
      expect(result.icd10Codes).toContain('K05.30');
      expect(result.scenarioPhrases[0].phrase_id).toBe('SCENARIO.PERIO.CHILLIN');
    }
  });

  it('D0210 (unmapped CDT) → no match', async () => {
    mockGetProtocolByCdt.mockResolvedValue([]);

    const result = await evaluate(makeOrderSelectRequest('D0210', ['K05.30']) as never, 'order-select');
    expect(result.type).toBe('no-match');
  });
});

describe('order-select: orthodontic CDT', () => {
  it('D8080 returns 3 orthodontic protocols', async () => {
    const orthoProtocols: ProtocolWithProduct[] = [1, 2, 3].map(i => ({
      ...PERIO_PROTOCOL,
      id: i,
      cdt_code: 'D8080',
      icd10_code: 'K07.6',
      product: { ...PERIO_PROTOCOL.product, id: i, name: `Product ${i}` },
    }));
    mockGetProtocolByCdt.mockResolvedValue(orthoProtocols);
    mockGetScenarioByCdt.mockResolvedValue([]);

    const result = await evaluate(makeOrderSelectRequest('D8080', ['K07.6']) as never, 'order-select');
    expect(result.type).toBe('match');
    if (result.type === 'match') {
      expect(result.protocols).toHaveLength(3);
    }
  });
});

describe('patient-view: ICD-10 driven', () => {
  it('K12.0 in encounterDx + problems → SCENARIO.ORALMED.MOUTHAID match', async () => {
    const mouthAidProtocol: ProtocolWithProduct = {
      ...PERIO_PROTOCOL,
      id: 5,
      cdt_code: 'D0140',
      icd10_code: 'K12.0',
      specialty: 'Oral Medicine',
    };
    const mouthAidPhrase: SmartPhrase = {
      ...PERIO_PHRASE,
      phrase_id: 'SCENARIO.ORALMED.MOUTHAID',
      icd10_codes: ['K12.0'],
    };

    mockGetProtocolsByIcd10.mockResolvedValue([mouthAidProtocol]);
    mockGetScenarioByIcd10.mockResolvedValue([mouthAidPhrase]);

    const result = await evaluate(
      makePatientViewRequest(['K12.0'], ['K12.0']) as never,
      'patient-view',
    );

    expect(result.type).toBe('match');
    if (result.type === 'match') {
      expect(result.scenarioPhrases[0].phrase_id).toBe('SCENARIO.ORALMED.MOUTHAID');
    }
  });

  it('encounterDx K12.0 NOT in problems → passive', async () => {
    const mouthAidProtocol: ProtocolWithProduct = {
      ...PERIO_PROTOCOL,
      id: 5,
      cdt_code: 'D0140',
      icd10_code: 'K12.0',
    };
    mockGetProtocolsByIcd10.mockResolvedValue([mouthAidProtocol]);
    mockGetScenarioByIcd10.mockResolvedValue([]);

    const result = await evaluate(
      makePatientViewRequest(['K12.0'], []) as never,
      'patient-view',
    );
    expect(result.type).toBe('passive');
  });
});
