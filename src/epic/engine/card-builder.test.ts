import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock deps so tests don't need DB or filesystem.
vi.mock('../repositories/smartphrase-repo.js', () => ({
  getPhrasesByIds: vi.fn().mockResolvedValue([]),
  getPhraseById: vi.fn().mockResolvedValue(null),
}));
vi.mock('./note-composer.js', () => ({
  composeNote: vi.fn().mockResolvedValue({ noteText: 'Test note content', phraseIdsUsed: [] }),
}));
vi.mock('../config.js', () => ({
  loadEpicConfig: vi.fn().mockReturnValue({
    EPIC_KEY_ID: 'test-kid',
    EPIC_CLIENT_ID: 'test-client',
    EPIC_CDS_BASE_URL: 'https://cds.orthonu.com',
    EPIC_SMART_LAUNCH_URL: 'https://app.orthonu.com/smart/launch',
    EPIC_ENV: 'sandbox',
    EPIC_FHIR_BASE_URL: 'https://fhir.epic.com',
    EPIC_PRIVATE_KEY_PATH: '/tmp/private.pem',
    EPIC_PUBLIC_KEY_PATH: '/tmp/public.pem',
  }),
}));

import { buildCard, buildPassiveCard, uuidv5, NAMESPACE_URL } from './card-builder.js';
import type { SmartPhrase } from '../types/smartphrase.js';
import type { ProtocolWithProduct } from '../../protocols/service.js';

const SCENARIO_PHRASE: SmartPhrase = {
  id: 1,
  phrase_id: 'SCENARIO.PERIO.CHILLIN',
  category: 'Scenario',
  title: 'Post-Periodontal Comfort Support',
  body_markdown: 'Periodontal support product recommended.',
  placeholder_tokens: [],
  cdt_codes: ['D4341'],
  icd10_codes: ['K05.30'],
  orthonu_product_id: 1,
  active: true,
};

const PROTOCOL: ProtocolWithProduct = {
  id: 1,
  cdt_code: 'D4341',
  diagnosis: 'Chronic periodontitis',
  specialty: 'Periodontics',
  icd10_code: 'K05.30',
  confidence_pct: 90,
  trigger_condition: null,
  application_notes: null,
  follow_up_protocol: null,
  product: {
    id: 1,
    name: 'Chillin Strips',
    sku: 'CHILL-001',
    msrp_cents: 1999,
    dso_price_cents: null,
    dissolvable: true,
    category: 'Periodontal',
    description: null,
  },
  dentira_variant_id: null,
};

describe('uuidv5 — deterministic card UUIDs', () => {
  it('same hookInstance + phraseId always produces the same UUID', () => {
    const u1 = uuidv5(NAMESPACE_URL, 'hook-abc:SCENARIO.PERIO.CHILLIN');
    const u2 = uuidv5(NAMESPACE_URL, 'hook-abc:SCENARIO.PERIO.CHILLIN');
    expect(u1).toBe(u2);
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('different inputs produce different UUIDs', () => {
    const u1 = uuidv5(NAMESPACE_URL, 'hook-abc:SCENARIO.PERIO.CHILLIN');
    const u2 = uuidv5(NAMESPACE_URL, 'hook-xyz:SCENARIO.PERIO.CHILLIN');
    expect(u1).not.toBe(u2);
  });
});

describe('buildCard', () => {
  it('returns card with correct indicator and source', async () => {
    const card = await buildCard({
      hookInstance: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      scenarioPhrase: SCENARIO_PHRASE,
      protocol: PROTOCOL,
      context: { cdtCode: 'D4341', icd10Code: 'K05.30' },
      patientId: 'PATIENT-1',
      encounterId: 'ENC-1',
    });

    expect(card.indicator).toBe('info');
    expect(card.source.label).toBe('OrthoNu Oral Intelligence Layer');
    expect(card.source.topic?.code).toBe('SCENARIO.PERIO.CHILLIN');
  });

  it('card UUID is deterministic for same hookInstance + phraseId', async () => {
    const hookInstance = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const card1 = await buildCard({ hookInstance, scenarioPhrase: SCENARIO_PHRASE, protocol: PROTOCOL, context: {}, patientId: 'P' });
    const card2 = await buildCard({ hookInstance, scenarioPhrase: SCENARIO_PHRASE, protocol: PROTOCOL, context: {}, patientId: 'P' });
    expect(card1.uuid).toBe(card2.uuid);
  });

  it('suggestion includes Condition resource with ICD-10 OID', async () => {
    const card = await buildCard({
      hookInstance: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      scenarioPhrase: SCENARIO_PHRASE,
      protocol: PROTOCOL,
      context: { icd10Code: 'K05.30' },
      patientId: 'P1',
      encounterId: 'ENC-1',
    });

    expect(card.suggestions).toHaveLength(1);
    const action = card.suggestions![0].actions[0];
    expect(action.type).toBe('create');
    const resource = action.resource as Record<string, unknown>;
    expect(resource.resourceType).toBe('Condition');
    const code = resource.code as { coding: Array<{ system: string; code: string }> };
    expect(code.coding[0].system).toBe('urn:oid:2.16.840.1.113883.6.90');
    expect(code.coding[0].code).toBe('K05.30');
  });

  it('links[0] includes appContext=hookInstance', async () => {
    const hookInstance = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const card = await buildCard({
      hookInstance,
      scenarioPhrase: SCENARIO_PHRASE,
      protocol: PROTOCOL,
      context: {},
      patientId: 'P1',
    });

    expect(card.links).toBeDefined();
    expect(card.links![0].appContext).toBe(hookInstance);
    expect(card.links![0].type).toBe('smart');
  });
});

describe('buildPassiveCard', () => {
  it('returns an info card with CORE.CDS.PASSIVE topic', () => {
    const card = buildPassiveCard('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'D4341');
    expect(card.indicator).toBe('info');
    expect(card.source.topic?.code).toBe('CORE.CDS.PASSIVE');
  });
});
