// Minimal FHIR R4 types needed by the Epic CDS integration.
// Do not use a FHIR client library — these are hand-written to match exactly
// what Epic sends in prefetch bundles and what we send in DocumentReference.Create.

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirReference {
  reference?: string;
}

// ─── Resources used in prefetch ───────────────────────────────────────────────

export interface FhirPatient {
  resourceType: 'Patient';
  id?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}

export interface FhirCondition {
  resourceType: 'Condition';
  id?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
}

export interface FhirServiceRequest {
  resourceType: 'ServiceRequest';
  status?: string;
  code?: FhirCodeableConcept;
  subject?: FhirReference;
}

export interface FhirBundleEntry {
  resource?: FhirPatient | FhirCondition | FhirServiceRequest | Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  entry?: FhirBundleEntry[];
}

// ─── DocumentReference (outbound write-back) ──────────────────────────────────

export interface FhirDocumentReference {
  resourceType: 'DocumentReference';
  docStatus: 'final';
  type: FhirCodeableConcept;
  subject: FhirReference;
  date: string;
  author?: FhirReference[];
  content: Array<{
    attachment: {
      contentType: string;
      data: string; // base64-encoded
    };
  }>;
  context?: {
    encounter?: FhirReference[];
  };
}

// ─── CDT / ICD-10 OID constants ───────────────────────────────────────────────

export const CDT_OID = 'urn:oid:2.16.840.1.113883.6.13';
export const ICD10_OID = 'urn:oid:2.16.840.1.113883.6.90';
export const ICD10_ALT = 'http://hl7.org/fhir/sid/icd-10-cm';
export const CONDITION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-category';
export const LOINC_SYSTEM = 'http://loinc.org';
export const PROGRESS_NOTE_LOINC = '11506-3';
