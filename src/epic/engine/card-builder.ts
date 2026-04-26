import { createHash } from 'crypto';
import type { Card, Suggestion, OverrideReason, CardLink } from '../types/cds-hooks.js';
import type { SmartPhrase } from '../types/smartphrase.js';
import type { ProtocolWithProduct } from '../../protocols/service.js';
import { loadEpicConfig } from '../config.js';
import {
  ICD10_OID,
  CONDITION_CATEGORY_SYSTEM,
  CDT_OID,
} from '../types/fhir-r4.js';
import { composeNote } from './note-composer.js';
import type { PlaceholderContext } from '../types/smartphrase.js';

// RFC 4122 NAMESPACE_URL in bytes — used for deterministic UUIDv5.
const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * UUIDv5: SHA1-based deterministic UUID (RFC 4122 §4.3).
 * Implemented with Node built-in crypto — no uuid package needed.
 */
function uuidv5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1');
  hash.update(nsBytes);
  hash.update(Buffer.from(name, 'utf8'));
  const d = hash.digest();
  d[6] = (d[6] & 0x0f) | 0x50; // version 5
  d[8] = (d[8] & 0x3f) | 0x80; // variant
  return [
    d.subarray(0, 4).toString('hex'),
    d.subarray(4, 6).toString('hex'),
    d.subarray(6, 8).toString('hex'),
    d.subarray(8, 10).toString('hex'),
    d.subarray(10, 16).toString('hex'),
  ].join('-');
}

const OVERRIDE_REASONS: OverrideReason[] = [
  { code: 'patient-declined',   display: 'Patient declined product' },
  { code: 'already-using',      display: 'Patient already using equivalent' },
  { code: 'contraindicated',    display: 'Clinical contraindication' },
  { code: 'not-indicated',      display: 'Not clinically indicated' },
  { code: 'exceeds-supportive', display: 'Symptoms exceed supportive workflow' },
  { code: 'cost-concern',       display: 'Cost concern' },
];

export interface BuildCardOptions {
  hookInstance: string;
  scenarioPhrase: SmartPhrase;
  protocol: ProtocolWithProduct;
  context: PlaceholderContext;
  patientId: string;
  encounterId?: string;
}

/** Builds one CDS Card for a matched protocol + scenario phrase pair. */
export async function buildCard(opts: BuildCardOptions): Promise<Card> {
  const cfg = loadEpicConfig();
  const { hookInstance, scenarioPhrase, protocol, context, patientId, encounterId } = opts;

  const cardUuid = uuidv5(NAMESPACE_URL, `${hookInstance}:${scenarioPhrase.phrase_id}`);

  // Compose the note text (markdown) for the card detail.
  // patientDecision is not set at hook time — placeholders resolve to '[not documented]'
  const { noteText } = await composeNote({
    scenarioPhrase,
    context,
  });

  // Suggestion: create encounter-diagnosis Condition for the matched ICD-10.
  const suggestions: Suggestion[] = [];
  if (protocol.icd10_code && encounterId) {
    const suggestionUuid = uuidv5(
      NAMESPACE_URL,
      `${hookInstance}:${scenarioPhrase.phrase_id}:suggestion`,
    );
    suggestions.push({
      label: `Add encounter diagnosis ${protocol.icd10_code}`,
      uuid: suggestionUuid,
      isRecommended: true,
      actions: [
        {
          type: 'create',
          description: `Add ${protocol.icd10_code} — ${protocol.diagnosis}`,
          resource: {
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
                  code: protocol.icd10_code,
                  display: protocol.diagnosis,
                },
              ],
              text: protocol.diagnosis,
            },
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${encounterId}` },
          },
        },
      ],
    });
  }

  const links: CardLink[] = [
    {
      label: 'View OrthoNu product details',
      url: cfg.EPIC_SMART_LAUNCH_URL ?? 'https://app.orthonu.com/smart/launch',
      type: 'smart',
      appContext: hookInstance,
    },
  ];

  // CDT code suggestion label for the summary
  const cdtDisplay = context.cdtCode
    ? ` (${context.cdtCode})`
    : '';

  return {
    uuid: cardUuid,
    summary: `OrthoNu: ${scenarioPhrase.title}${cdtDisplay}`,
    detail: noteText,
    indicator: 'info',
    source: {
      label: 'OrthoNu Oral Intelligence Layer',
      url: 'https://www.orthonu.com',
      topic: { code: scenarioPhrase.phrase_id },
    },
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    selectionBehavior: 'any',
    overrideReasons: OVERRIDE_REASONS,
    links,
  };
}

/** Builds a passive informational card when CDT matched but ICD-10 not confirmed. */
export function buildPassiveCard(hookInstance: string, cdtCode?: string): Card {
  const cfg = loadEpicConfig();
  const cardUuid = uuidv5(NAMESPACE_URL, `${hookInstance}:CORE.CDS.PASSIVE`);

  return {
    uuid: cardUuid,
    summary: 'OrthoNu: Supportive oral care products available for this procedure',
    detail:
      'OrthoNu supportive oral care products may benefit this patient. ' +
      'Review patient history and consider recommending appropriate products.',
    indicator: 'info',
    source: {
      label: 'OrthoNu Oral Intelligence Layer',
      url: 'https://www.orthonu.com',
      topic: { code: 'CORE.CDS.PASSIVE' },
    },
    overrideReasons: OVERRIDE_REASONS,
    links: [
      {
        label: 'View OrthoNu product details',
        url: cfg.EPIC_SMART_LAUNCH_URL ?? 'https://app.orthonu.com/smart/launch',
        type: 'smart',
        appContext: hookInstance,
      },
    ],
  };
}

export { uuidv5, NAMESPACE_URL };
