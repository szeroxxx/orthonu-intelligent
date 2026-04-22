import type { Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import type { WebhookOrderPayload } from './types.js';

// TODO: Implement HMAC signature verification once Deepankar confirms the signing mechanism.
// The signing secret is stored in DENTIRA_WEBHOOK_SECRET env var.
// Expected pattern: compare HMAC-SHA256(rawBody, secret) against the signature header.
function verifySignature(_rawBody: Buffer, _signature: string | undefined): boolean {
  return true; // stub — always passes until Dentira confirms signing spec
}

export async function handleDentiraWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-dentira-signature'] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  // 1. Verify signature (stubbed)
  if (!verifySignature(rawBody ?? Buffer.from(''), signature)) {
    logger.warn({ signature }, 'Webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as WebhookOrderPayload;
  const orderId = payload?.order?.id;

  if (!orderId) {
    logger.warn('Webhook missing order.id');
    res.status(400).json({ error: 'Missing order.id' });
    return;
  }

  // 2. Idempotency check — skip if already logged
  const { rows: existing } = await pool.query(
    `SELECT id FROM webhook_log
     WHERE payload_jsonb->>'orderId' = $1 AND processed = TRUE
     LIMIT 1`,
    [orderId],
  );

  if (existing.length > 0) {
    logger.info({ orderId }, 'Duplicate webhook — already processed, skipping');
    res.status(200).json({ status: 'duplicate' });
    return;
  }

  // 3. Store raw payload in webhook_log
  const { rows: logRows } = await pool.query<{ id: number }>(
    `INSERT INTO webhook_log (source, payload_jsonb, signature, processed)
     VALUES ('dentira', $1, $2, FALSE)
     RETURNING id`,
    [JSON.stringify({ orderId, ...payload }), signature ?? null],
  );

  const webhookLogId = logRows[0].id;
  logger.info({ orderId, webhookLogId }, 'Webhook logged, enqueuing job');

  // 4. Enqueue pg-boss job — import lazily to avoid circular dep at startup
  const { bossInstance } = await import('../jobs/index.js');
  await bossInstance.send('process-order', { webhookLogId, orderId });

  // 5. Return 200 immediately — never let Dentira wait on our processing
  res.status(200).json({ status: 'accepted', webhookLogId });
}
