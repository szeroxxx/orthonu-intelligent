export type PhraseCategory =
  | 'Core'
  | 'Product'
  | 'Scenario'
  | 'Operational'
  | 'Diagnosis';

export interface SmartPhrase {
  id: number;
  phrase_id: string;
  category: PhraseCategory;
  title: string;
  body_markdown: string;
  placeholder_tokens: string[];
  cdt_codes: string[] | null;
  icd10_codes: string[] | null;
  orthonu_product_id: number | null;
  active: boolean;
}

export interface ComposedNote {
  noteText: string;
  phraseIdsUsed: string[];
}

// PlaceholderContext is passed to the resolver when composing a note.
export interface PlaceholderContext {
  symptoms?: string;
  clinicalFindings?: string;
  cdtCode?: string;
  procedureDescription?: string;
  icd10Code?: string;
  diagnosisDescription?: string;
  patientDecision?: 'accepted' | 'declined';
  clinicalContext?: string;
  clinicalIssue?: string;
  responseToProductOrPlan?: string;
}
