import { getPhrasesByIds, getPhraseById } from '../repositories/smartphrase-repo.js';
import { resolvePlaceholders } from './placeholder-resolver.js';
import { logger } from '../../lib/logger.js';
import type { ComposedNote, PlaceholderContext } from '../types/smartphrase.js';
import type { SmartPhrase } from '../types/smartphrase.js';

// Composition order per spec §5.2:
//   CORE.ASSESS.GENERAL → CORE.COUNSEL.OPTIONAL → SCENARIO.*.* →
//   CORE.PLAN.{ACCEPTED|DECLINED} → CORE.FOLLOWUP.GENERAL
//
// OPS.* phrases are intentionally excluded (operational, not clinical — spec §7, Build Rec #7).

const CORE_ASSESS_PHRASE_ID = 'CORE.ASSESS.GENERAL';
const CORE_COUNSEL_PHRASE_ID = 'CORE.COUNSEL.OPTIONAL';
const CORE_PLAN_ACCEPTED_ID = 'CORE.PLAN.ACCEPTED';
const CORE_PLAN_DECLINED_ID = 'CORE.PLAN.DECLINED';
const CORE_FOLLOWUP_PHRASE_ID = 'CORE.FOLLOWUP.GENERAL';

export interface ComposeNoteOptions {
  scenarioPhrase: SmartPhrase;
  context: PlaceholderContext;
  patientDecision?: 'accepted' | 'declined';
}

/**
 * Assembles a plain-text clinical note from modular SmartPhrases.
 * Returns noteText (pre-base64) and phraseIdsUsed[] for the audit table.
 */
export async function composeNote(opts: ComposeNoteOptions): Promise<ComposedNote> {
  const planPhraseId =
    opts.patientDecision === 'declined' ? CORE_PLAN_DECLINED_ID : CORE_PLAN_ACCEPTED_ID;

  const phraseIds = [
    CORE_ASSESS_PHRASE_ID,
    CORE_COUNSEL_PHRASE_ID,
    opts.scenarioPhrase.phrase_id,
    planPhraseId,
    CORE_FOLLOWUP_PHRASE_ID,
  ];

  // Batch-load all phrases — smartphrase-repo deduplicates.
  const corePhrases = await getPhrasesByIds([
    CORE_ASSESS_PHRASE_ID,
    CORE_COUNSEL_PHRASE_ID,
    planPhraseId,
    CORE_FOLLOWUP_PHRASE_ID,
  ]);

  const phraseMap = new Map<string, SmartPhrase>();
  for (const p of [...corePhrases, opts.scenarioPhrase]) {
    phraseMap.set(p.phrase_id, p);
  }

  const warnUnknownToken = (token: string) => {
    logger.warn({ token, scenarioPhraseId: opts.scenarioPhrase.phrase_id }, 'Unknown placeholder token in phrase');
  };

  const segments: string[] = [];
  const phraseIdsUsed: string[] = [];

  for (const phraseId of phraseIds) {
    const phrase = phraseMap.get(phraseId);
    if (!phrase) {
      // Core phrase not seeded yet — insert placeholder section.
      logger.warn({ phraseId }, 'SmartPhrase not found in DB during note composition');
      segments.push(`[${phraseId}: not yet configured]`);
      continue;
    }
    const resolved = resolvePlaceholders(phrase.body_markdown, opts.context, warnUnknownToken);
    segments.push(resolved);
    phraseIdsUsed.push(phraseId);
  }

  return {
    noteText: segments.join('\n\n'),
    phraseIdsUsed,
  };
}

/**
 * Composes a passive note (no specific scenario match).
 * Uses CORE.CDS.PASSIVE if seeded; otherwise returns a generic fallback.
 */
export async function composePassiveNote(ctx: PlaceholderContext): Promise<ComposedNote> {
  const passive = await getPhraseById('CORE.CDS.PASSIVE');
  if (passive) {
    const noteText = resolvePlaceholders(passive.body_markdown, ctx);
    return { noteText, phraseIdsUsed: ['CORE.CDS.PASSIVE'] };
  }

  // Fallback when phrase not yet seeded.
  const noteText =
    'OrthoNu supportive oral care products may benefit this patient based on the current procedure. ' +
    'Clinician assessment required before recommendation.';
  return { noteText, phraseIdsUsed: [] };
}
