import { z } from 'zod';

// ─── FHIR primitives used inside hook requests ────────────────────────────────

export const fhirBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  entry: z
    .array(
      z.object({
        resource: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const fhirAuthSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
    scope: z.string(),
    subject: z.string(),
  })
  .optional();

const hookContextSchema = z.object({
  userId: z.string().optional(),
  patientId: z.string(),
  encounterId: z.string().optional(),
  draftOrders: fhirBundleSchema.optional(),
});

// ─── CDS Hook request (validated at handler entry) ────────────────────────────

export const cdsHookRequestSchema = z.object({
  hookInstance: z.string().uuid(),
  fhirServer: z.string().url(),
  hook: z.string(),
  fhirAuthorization: fhirAuthSchema,
  context: hookContextSchema,
  prefetch: z.record(z.unknown()).optional(),
});

export type CdsServiceRequest = z.infer<typeof cdsHookRequestSchema>;

// ─── CDS Hook response ────────────────────────────────────────────────────────

export interface OverrideReason {
  code: string;
  display: string;
}

export interface CardSource {
  label: string;
  url?: string;
  topic?: { code: string; display?: string };
}

export interface SuggestionAction {
  type: 'create' | 'update' | 'delete';
  description: string;
  resource?: Record<string, unknown>;
}

export interface Suggestion {
  label: string;
  uuid: string;
  isRecommended?: boolean;
  actions: SuggestionAction[];
}

export interface CardLink {
  label: string;
  url: string;
  type: 'absolute' | 'smart';
  appContext?: string;
}

export interface Card {
  uuid: string;
  summary: string;
  detail?: string;
  indicator: 'info' | 'warning' | 'critical';
  source: CardSource;
  suggestions?: Suggestion[];
  selectionBehavior?: 'any' | 'at-most-one';
  overrideReasons?: OverrideReason[];
  links?: CardLink[];
}

export interface CdsServiceResponse {
  cards: Card[];
}

// ─── Service discovery ────────────────────────────────────────────────────────

export interface CdsService {
  hook: string;
  title: string;
  description: string;
  id: string;
  prefetch?: Record<string, string>;
}

export interface CdsServicesResponse {
  services: CdsService[];
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

// DECISION: hookInstance added as optional at top level — Epic's CDS Hooks
// implementation typically includes it even though the 1.0 spec body example
// omits it. Without it, write-back cannot be linked to the source invocation.
// The epic_cds_feedback.hook_instance column is nullable for this reason.
const feedbackItemSchema = z.object({
  card: z.string().uuid(),
  outcome: z.enum(['accepted', 'overridden', 'dismissed']),
  acceptedSuggestions: z.array(z.object({ id: z.string() })).optional(),
  overrideReasons: z
    .array(z.object({ code: z.string(), display: z.string() }))
    .optional(),
  outcomeTimestamp: z.string().optional(),
});

export const feedbackRequestSchema = z.object({
  hookInstance: z.string().uuid().optional(),
  feedback: z.array(feedbackItemSchema),
});

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;
