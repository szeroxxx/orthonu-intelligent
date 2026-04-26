import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { feedbackRequestSchema } from '../types/cds-hooks.js';
import { insertFeedback } from '../repositories/feedback-repo.js';
import { getInvocationByHookInstance } from '../repositories/invocation-repo.js';
import { WRITE_BACK_JOB_NAME } from '../workers/write-back-worker.js';

// pg-boss instance is imported lazily to avoid circular dependency at startup,
// matching the pattern used by src/dentira/webhook-handler.ts.
async function getBoss() {
  const { bossInstance } = await import('../../jobs/index.js');
  return bossInstance;
}

export async function feedbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const parsed = feedbackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
      return;
    }

    const { hookInstance, feedback } = parsed.data;

    // Return 200 immediately — spec requires non-blocking acknowledgement.
    res.status(200).json({});

    // Process asynchronously after response is sent.
    processFeedbackAsync(hookInstance, feedback, req.body).catch(err => {
      logger.error({ err, hookInstance }, 'Async feedback processing error');
    });
  } catch (err) {
    logger.error({ err }, 'Feedback handler error');
    // Response may already be sent; only write if not.
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

async function processFeedbackAsync(
  hookInstance: string | undefined,
  feedbackItems: Array<{ card: string; outcome: string; acceptedSuggestions?: Array<{ id: string }>; overrideReasons?: Array<{ code: string; display: string }>; outcomeTimestamp?: string }>,
  rawBody: object,
): Promise<void> {
  // Look up the invocation if hookInstance provided — needed for write-back decision.
  const invocation = hookInstance
    ? await getInvocationByHookInstance(hookInstance)
    : null;

  for (const item of feedbackItems) {
    const row = await insertFeedback(
      hookInstance,
      item as Parameters<typeof insertFeedback>[1],
      rawBody,
    );

    logger.info(
      { hookInstance, cardUuid: item.card, outcome: item.outcome },
      'CDS feedback received',
    );

    // Enqueue write-back for accepted scenario-match cards only.
    // Passive cards (matched_protocol_ids null/empty) do not trigger DocumentReference.Create.
    if (
      item.outcome === 'accepted' &&
      hookInstance &&
      invocation &&
      invocation.matched_protocol_ids &&
      invocation.matched_protocol_ids.length > 0
    ) {
      try {
        const boss = await getBoss();
        await boss.send(
          WRITE_BACK_JOB_NAME,
          { feedbackId: row.id },
          {
            retryLimit: 3,
            retryBackoff: true,
            retryDelay: 60,
          },
        );
        logger.info({ feedbackId: row.id, hookInstance }, 'Write-back job enqueued');
      } catch (err) {
        logger.error({ err, feedbackId: row.id }, 'Failed to enqueue write-back job');
      }
    }
  }
}
