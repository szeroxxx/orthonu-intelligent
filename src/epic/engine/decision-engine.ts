import { getProtocolByCdt, getProtocolsByIcd10 } from '../../protocols/service.js';
import type { ProtocolWithProduct } from '../../protocols/service.js';
import {
  getScenarioPhrasesByCdt,
  getScenarioPhrasesByIcd10,
} from '../repositories/smartphrase-repo.js';
import type { SmartPhrase } from '../types/smartphrase.js';
import type { CdsServiceRequest } from '../types/cds-hooks.js';
import type { FhirCondition, FhirServiceRequest, FhirBundle } from '../types/fhir-r4.js';
import { CDT_OID, ICD10_OID, ICD10_ALT } from '../types/fhir-r4.js';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface NoMatchResult {
  type: 'no-match';
}

export interface PassiveResult {
  type: 'passive';
  cdtCode?: string;
  icd10Codes?: string[];
  protocols: ProtocolWithProduct[];
}

export interface ProtocolMatchResult {
  type: 'match';
  protocols: ProtocolWithProduct[];
  scenarioPhrases: SmartPhrase[];
  cdtCode?: string;
  icd10Codes: string[];
}

export type DecisionResult = NoMatchResult | PassiveResult | ProtocolMatchResult;

// ─── Simple in-memory cache (5-min TTL) for protocol lookups ─────────────────
// Keeps the hot path under 100ms on warm DB — protocols change only on migration.

const _protocolCache = new Map<string, { data: ProtocolWithProduct[]; ts: number }>();
const _CACHE_TTL_MS = 5 * 60 * 1000;

async function cachedGetProtocolByCdt(cdtCode: string): Promise<ProtocolWithProduct[]> {
  const cached = _protocolCache.get(`cdt:${cdtCode}`);
  if (cached && Date.now() - cached.ts < _CACHE_TTL_MS) return cached.data;
  const data = await getProtocolByCdt(cdtCode);
  _protocolCache.set(`cdt:${cdtCode}`, { data, ts: Date.now() });
  return data;
}

async function cachedGetProtocolsByIcd10(icd10Code: string): Promise<ProtocolWithProduct[]> {
  const cached = _protocolCache.get(`icd10:${icd10Code}`);
  if (cached && Date.now() - cached.ts < _CACHE_TTL_MS) return cached.data;
  const data = await getProtocolsByIcd10(icd10Code);
  _protocolCache.set(`icd10:${icd10Code}`, { data, ts: Date.now() });
  return data;
}

// ─── FHIR extraction helpers ──────────────────────────────────────────────────

function extractCdtCodesFromBundle(bundle: FhirBundle): string[] {
  const codes: string[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource as FhirServiceRequest | undefined;
    if (!resource?.code?.coding) continue;
    for (const coding of resource.code.coding) {
      if (coding.system === CDT_OID && coding.code) {
        codes.push(coding.code);
      }
    }
  }
  return [...new Set(codes)];
}

function extractIcd10CodesFromBundle(
  bundle: { entry?: Array<{ resource?: FhirCondition | Record<string, unknown> }> } | undefined,
): string[] {
  const codes: string[] = [];
  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource as FhirCondition | undefined;
    if (!resource?.code?.coding) continue;
    for (const coding of resource.code.coding) {
      if (
        (coding.system === ICD10_OID || coding.system === ICD10_ALT) &&
        coding.code
      ) {
        codes.push(coding.code);
      }
    }
  }
  return [...new Set(codes)];
}

// ─── Main evaluate function ───────────────────────────────────────────────────

/**
 * Two-step decision model (spec §4.2):
 * Step 1 — CDT (order-select) or encounterDx ICD-10 (patient-view) match
 * Step 2 — Supporting symptoms in problems list
 *
 * Returns:
 *   NoMatchResult   — Step 1 did not match any known protocol
 *   PassiveResult   — Step 1 matched, Step 2 did not (no supporting symptoms)
 *   ProtocolMatchResult — Both steps matched
 */
export async function evaluate(
  request: CdsServiceRequest,
  hookType: 'patient-view' | 'order-select',
): Promise<DecisionResult> {
  const prefetch = request.prefetch as
    | Record<string, { resourceType: string; entry?: Array<{ resource?: Record<string, unknown> }> }>
    | undefined;

  const problemsBundle = prefetch?.['problems'] as
    | { entry?: Array<{ resource?: FhirCondition }> }
    | undefined;
  const problemIcd10Codes = extractIcd10CodesFromBundle(problemsBundle);

  if (hookType === 'order-select') {
    return evaluateOrderSelect(request, problemIcd10Codes);
  }
  return evaluatePatientView(request, prefetch, problemIcd10Codes);
}

async function evaluateOrderSelect(
  request: CdsServiceRequest,
  problemIcd10Codes: string[],
): Promise<DecisionResult> {
  const draftOrders = request.context.draftOrders as FhirBundle | undefined;
  if (!draftOrders) return { type: 'no-match' };

  const cdtCodes = extractCdtCodesFromBundle(draftOrders);
  if (cdtCodes.length === 0) return { type: 'no-match' };

  // Use the first CDT code that has protocols (typical: one procedure per hook).
  for (const cdtCode of cdtCodes) {
    const protocols = await cachedGetProtocolByCdt(cdtCode);
    if (protocols.length === 0) continue;

    // Step 2: check if any protocol's ICD-10 appears in the patient's problems list.
    const matchedIcd10 = protocols
      .map(p => p.icd10_code)
      .filter((c): c is string => !!c)
      .filter(c => problemIcd10Codes.includes(c));

    const scenarioPhrases = await getScenarioPhrasesByCdt(cdtCode);

    if (matchedIcd10.length > 0) {
      return {
        type: 'match',
        protocols,
        scenarioPhrases,
        cdtCode,
        icd10Codes: matchedIcd10,
      };
    }

    // Step 1 matched but Step 2 did not — passive result.
    return {
      type: 'passive',
      cdtCode,
      icd10Codes: problemIcd10Codes,
      protocols,
    };
  }

  return { type: 'no-match' };
}

async function evaluatePatientView(
  _request: CdsServiceRequest,
  prefetch:
    | Record<string, { resourceType: string; entry?: Array<{ resource?: Record<string, unknown> }> }>
    | undefined,
  problemIcd10Codes: string[],
): Promise<DecisionResult> {
  const encounterDxBundle = prefetch?.['encounterDx'] as
    | { entry?: Array<{ resource?: FhirCondition }> }
    | undefined;

  const encounterIcd10Codes = extractIcd10CodesFromBundle(encounterDxBundle);
  if (encounterIcd10Codes.length === 0) {
    // No encounter diagnosis — prefetch absent or empty, return passive if any problems
    if (problemIcd10Codes.length === 0) return { type: 'no-match' };
    return { type: 'passive', icd10Codes: problemIcd10Codes, protocols: [] };
  }

  // Step 1: find protocols by encounterDx ICD-10.
  for (const icd10Code of encounterIcd10Codes) {
    const protocols = await cachedGetProtocolsByIcd10(icd10Code);
    if (protocols.length === 0) continue;

    // Step 2: confirm the ICD-10 is also in the problems list (active chronic condition).
    const confirmedInProblems = problemIcd10Codes.includes(icd10Code);

    const scenarioPhrases = await getScenarioPhrasesByIcd10(icd10Code);

    if (confirmedInProblems) {
      return {
        type: 'match',
        protocols,
        scenarioPhrases,
        icd10Codes: [icd10Code],
      };
    }

    // Step 1 matched (encounterDx), Step 2 did not (not in problems).
    return {
      type: 'passive',
      icd10Codes: [icd10Code],
      protocols,
    };
  }

  return { type: 'no-match' };
}

/** Flush protocol cache — for unit tests. */
export function _flushProtocolCache(): void {
  _protocolCache.clear();
}
