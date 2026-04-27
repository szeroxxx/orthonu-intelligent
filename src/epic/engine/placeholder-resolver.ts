import type { PlaceholderContext } from '../types/smartphrase.js';

const KNOWN_TOKENS = new Set([
  'SYMPTOMS',
  'CLINICAL_FINDINGS',
  'CDT_CODE',
  'PROCEDURE_DESCRIPTION',
  'ICD10_CODE',
  'DIAGNOSIS_DESCRIPTION',
  'PATIENT_DECISION',
  'CLINICAL_CONTEXT',
  'CLINICAL_ISSUE',
  'RESPONSE_TO_PRODUCT_OR_PLAN',
]);

const TOKEN_RE = /\{([A-Z_]+)\}/g;

/**
 * Replaces {TOKEN} placeholders in a phrase body.
 * Unresolved tokens → '[not documented]' — raw braces never appear in output.
 * Tokens not in the known set are warned but still resolved.
 */
export function resolvePlaceholders(
  text: string,
  ctx: PlaceholderContext,
  warn?: (token: string) => void,
): string {
  return text.replace(TOKEN_RE, (_match, token: string) => {
    if (!KNOWN_TOKENS.has(token) && warn) {
      warn(token);
    }
    const resolved = resolveToken(token, ctx);
    return resolved ?? '[not documented]';
  });
}

function resolveToken(token: string, ctx: PlaceholderContext): string | undefined {
  switch (token) {
    case 'SYMPTOMS':
      return ctx.symptoms;
    case 'CLINICAL_FINDINGS':
      return ctx.clinicalFindings;
    case 'CDT_CODE':
      return ctx.cdtCode;
    case 'PROCEDURE_DESCRIPTION':
      return ctx.procedureDescription;
    case 'ICD10_CODE':
      return ctx.icd10Code;
    case 'DIAGNOSIS_DESCRIPTION':
      return ctx.diagnosisDescription;
    case 'PATIENT_DECISION':
      return ctx.patientDecision ?? 'pending';
    case 'CLINICAL_CONTEXT':
      return ctx.clinicalContext;
    case 'CLINICAL_ISSUE':
      return ctx.clinicalIssue;
    case 'RESPONSE_TO_PRODUCT_OR_PLAN':
      return ctx.responseToProductOrPlan;
    default:
      return undefined;
  }
}
