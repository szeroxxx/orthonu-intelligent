import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { cdsHookRequestSchema } from '../types/cds-hooks.js';
import type { CdsServiceResponse } from '../types/cds-hooks.js';
import { evaluate } from '../engine/decision-engine.js';
import { shouldSuppress } from '../engine/suppression.js';
import { buildCard, buildPassiveCard } from '../engine/card-builder.js';
import { insertInvocation } from '../repositories/invocation-repo.js';
import type { PlaceholderContext } from '../types/smartphrase.js';

const SERVICE_ID = 'orthonu-protocol-engine';
const SLOW_THRESHOLD_MS = 400;

export async function orderSelectHandler(req: Request, res: Response): Promise<void> {
  const start = Date.now();
  let invocationId: number | undefined;

  try {
    const parsed = cdsHookRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }

    const request = parsed.data;
    const { hookInstance, fhirServer, context } = request;

    const result = await evaluate(request, 'order-select');
    const suppression = shouldSuppress(request, result);

    const durationMs = Date.now() - start;

    if (suppression.suppressed) {
      const inv = await insertInvocation({
        hookInstance,
        hookType: 'order-select',
        serviceId: SERVICE_ID,
        fhirServer,
        epicClientId: req.epicJwt?.sub ?? '',
        patientId: context.patientId,
        userId: context.userId,
        encounterId: context.encounterId,
        cdtCode: result.type !== 'no-match' ? (result as { cdtCode?: string }).cdtCode : undefined,
        cardCount: 0,
        suppressed: true,
        suppressionReason: suppression.reason,
        responseTimeMs: durationMs,
      });
      invocationId = inv.id;

      logInvocation(hookInstance, SERVICE_ID, 'order-select', context.patientId, 0, true, durationMs);
      res.json({ cards: [] } satisfies CdsServiceResponse);
      return;
    }

    if (result.type === 'no-match') {
      await insertInvocation({
        hookInstance,
        hookType: 'order-select',
        serviceId: SERVICE_ID,
        fhirServer,
        epicClientId: req.epicJwt?.sub ?? '',
        patientId: context.patientId,
        userId: context.userId,
        encounterId: context.encounterId,
        cardCount: 0,
        suppressed: false,
        responseTimeMs: Date.now() - start,
      });
      logInvocation(hookInstance, SERVICE_ID, 'order-select', context.patientId, 0, false, durationMs);
      res.json({ cards: [] } satisfies CdsServiceResponse);
      return;
    }

    if (result.type === 'passive') {
      const passiveCard = buildPassiveCard(hookInstance, result.cdtCode);
      await insertInvocation({
        hookInstance,
        hookType: 'order-select',
        serviceId: SERVICE_ID,
        fhirServer,
        epicClientId: req.epicJwt?.sub ?? '',
        patientId: context.patientId,
        userId: context.userId,
        encounterId: context.encounterId,
        cdtCode: result.cdtCode,
        icd10Codes: result.icd10Codes,
        matchedProtocolIds: result.protocols.map(p => p.id),
        cardCount: 1,
        suppressed: false,
        responseTimeMs: Date.now() - start,
      });
      logInvocation(hookInstance, SERVICE_ID, 'order-select', context.patientId, 1, false, durationMs);
      res.json({ cards: [passiveCard] } satisfies CdsServiceResponse);
      return;
    }

    // Full match — build scenario cards.
    const ctx: PlaceholderContext = {
      cdtCode: result.cdtCode,
      icd10Code: result.icd10Codes[0],
      diagnosisDescription: result.protocols[0]?.diagnosis,
      clinicalIssue: result.protocols[0]?.trigger_condition ?? undefined,
    };

    const cards = await Promise.all(
      result.scenarioPhrases.map(phrase =>
        buildCard({
          hookInstance,
          scenarioPhrase: phrase,
          protocol: result.protocols[0],
          context: ctx,
          patientId: context.patientId,
          encounterId: context.encounterId,
        }),
      ),
    );

    const totalMs = Date.now() - start;
    if (totalMs > SLOW_THRESHOLD_MS) {
      logger.warn({ hookInstance, durationMs: totalMs }, 'order-select handler exceeded 400ms');
    }

    const inv = await insertInvocation({
      hookInstance,
      hookType: 'order-select',
      serviceId: SERVICE_ID,
      fhirServer,
      epicClientId: req.epicJwt?.sub ?? '',
      patientId: context.patientId,
      userId: context.userId,
      encounterId: context.encounterId,
      cdtCode: result.cdtCode,
      icd10Codes: result.icd10Codes,
      matchedProtocolIds: result.protocols.map(p => p.id),
      cardCount: cards.length,
      suppressed: false,
      responseTimeMs: totalMs,
    });
    invocationId = inv.id;

    logInvocation(hookInstance, SERVICE_ID, 'order-select', context.patientId, cards.length, false, totalMs);
    res.json({ cards } satisfies CdsServiceResponse);
  } catch (err: unknown) {
    logger.error({ err, invocationId }, 'order-select handler error');
    res.status(500).json({ error: 'internal_error', reference: invocationId });
  }
}

function patientIdHash(patientId: string): string {
  return createHash('sha256').update(patientId).digest('hex').slice(0, 12);
}

function logInvocation(
  hookInstance: string,
  serviceId: string,
  hookType: string,
  patientId: string,
  cardCount: number,
  suppressed: boolean,
  durationMs: number,
): void {
  logger.info({
    hookInstance,
    serviceId,
    hookType,
    cardCount,
    suppressed,
    durationMs,
    patientIdHash: patientIdHash(patientId),
  });
}
