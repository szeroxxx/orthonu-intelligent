import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/smartphrase-repo.js', () => ({
  getPhrasesByIds: vi.fn(),
  getPhraseById: vi.fn(),
}));

import { composeNote, composePassiveNote } from './note-composer.js';
import { getPhrasesByIds, getPhraseById } from '../repositories/smartphrase-repo.js';
import type { SmartPhrase } from '../types/smartphrase.js';

const mockGetPhrasesByIds = vi.mocked(getPhrasesByIds);
const mockGetPhraseById = vi.mocked(getPhraseById);

const makePhrase = (phraseId: string, body: string): SmartPhrase => ({
  id: 1,
  phrase_id: phraseId,
  category: phraseId.startsWith('CORE') ? 'Core' : 'Scenario',
  title: phraseId,
  body_markdown: body,
  placeholder_tokens: [],
  cdt_codes: null,
  icd10_codes: null,
  orthonu_product_id: null,
  active: true,
});

const ASSESS = makePhrase('CORE.ASSESS.GENERAL', 'Assessment: {CLINICAL_FINDINGS}.');
const COUNSEL = makePhrase('CORE.COUNSEL.OPTIONAL', 'Counseling provided.');
const PLAN_ACCEPTED = makePhrase('CORE.PLAN.ACCEPTED', 'Patient accepted the plan: {PATIENT_DECISION}.');
const PLAN_DECLINED = makePhrase('CORE.PLAN.DECLINED', 'Patient declined: {PATIENT_DECISION}.');
const FOLLOWUP = makePhrase('CORE.FOLLOWUP.GENERAL', 'Follow up in 4 weeks.');
const SCENARIO = makePhrase('SCENARIO.PERIO.CHILLIN', 'Periodontal comfort product recommended. CDT: {CDT_CODE}. Issue: {MISSING_TOKEN}.');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('composeNote', () => {
  it('composes PERIO.CHILLIN note correctly with placeholders resolved', async () => {
    mockGetPhrasesByIds.mockResolvedValue([ASSESS, COUNSEL, PLAN_ACCEPTED, FOLLOWUP]);

    const { noteText, phraseIdsUsed } = await composeNote({
      scenarioPhrase: SCENARIO,
      context: {
        clinicalFindings: 'Chronic periodontitis',
        cdtCode: 'D4341',
        patientDecision: 'accepted',
      },
    });

    expect(noteText).toContain('Chronic periodontitis');
    expect(noteText).toContain('D4341');
    expect(noteText).toContain('Follow up in 4 weeks');
    expect(phraseIdsUsed).toContain('CORE.ASSESS.GENERAL');
    expect(phraseIdsUsed).toContain('SCENARIO.PERIO.CHILLIN');
  });

  it('missing context values → [not documented] substitutions', async () => {
    mockGetPhrasesByIds.mockResolvedValue([ASSESS, COUNSEL, PLAN_ACCEPTED, FOLLOWUP]);

    const { noteText } = await composeNote({
      scenarioPhrase: SCENARIO,
      context: {},
    });

    // {CLINICAL_FINDINGS}, {CDT_CODE} both unset → [not documented]
    expect(noteText).toContain('[not documented]');
  });

  it('declined outcome uses CORE.PLAN.DECLINED', async () => {
    mockGetPhrasesByIds.mockResolvedValue([ASSESS, COUNSEL, PLAN_DECLINED, FOLLOWUP]);

    const { noteText } = await composeNote({
      scenarioPhrase: SCENARIO,
      context: { patientDecision: 'declined' },
      patientDecision: 'declined',
    });

    expect(noteText).toContain('Patient declined');
  });

  it('missing core phrase inserts placeholder section', async () => {
    // CORE.ASSESS.GENERAL missing from DB
    mockGetPhrasesByIds.mockResolvedValue([COUNSEL, PLAN_ACCEPTED, FOLLOWUP]);

    const { noteText } = await composeNote({
      scenarioPhrase: SCENARIO,
      context: {},
    });

    expect(noteText).toContain('[CORE.ASSESS.GENERAL: not yet configured]');
  });
});

describe('composePassiveNote', () => {
  it('uses CORE.CDS.PASSIVE phrase when seeded', async () => {
    const passivePhrase = makePhrase('CORE.CDS.PASSIVE', 'OrthoNu products may help with {CDT_CODE}.');
    mockGetPhraseById.mockResolvedValue(passivePhrase);

    const { noteText, phraseIdsUsed } = await composePassiveNote({ cdtCode: 'D4341' });
    expect(noteText).toContain('D4341');
    expect(phraseIdsUsed).toContain('CORE.CDS.PASSIVE');
  });

  it('returns fallback when CORE.CDS.PASSIVE not seeded', async () => {
    mockGetPhraseById.mockResolvedValue(null);

    const { noteText, phraseIdsUsed } = await composePassiveNote({});
    expect(noteText).toContain('OrthoNu');
    expect(phraseIdsUsed).toHaveLength(0);
  });
});
