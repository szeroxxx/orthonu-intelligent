import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { updateVendorOrder } from './graphql-client.js';
import { config } from '../config/index.js';
import type { WebhookOrderPayload } from './types.js';

const TAX_RATE = 0.0975; // TODO: Replace with real tax service integration

export interface ProcessOrderJobData {
  webhookLogId: number;
  orderId: string;
}

export async function processOrder(data: ProcessOrderJobData): Promise<void> {
  const { webhookLogId, orderId } = data;
  const log = logger.child({ webhookLogId, orderId });

  try {
    // 1. Load the raw payload from webhook_log
    const { rows: logRows } = await pool.query<{ payload_jsonb: WebhookOrderPayload & { orderId: string } }>(
      'SELECT payload_jsonb FROM webhook_log WHERE id = $1',
      [webhookLogId],
    );

    if (logRows.length === 0) {
      throw new Error(`webhook_log row ${webhookLogId} not found`);
    }

    const payload = logRows[0].payload_jsonb as unknown as { orderId: string } & WebhookOrderPayload;
    const order = payload.order;

    // 2. Idempotency — skip if order already exists in orders table
    const { rows: existing } = await pool.query(
      'SELECT id FROM orders WHERE dentira_order_id = $1 LIMIT 1',
      [order.id],
    );

    if (existing.length > 0) {
      log.info('Order already processed — skipping duplicate');
      await markWebhookProcessed(webhookLogId);
      return;
    }

    // 3. Resolve prescription_id (best-effort — may be null if prescription wasn't via OrthoNu)
    const prescriptionId = order.orderItems[0]?.prescriptionId ?? null;
    let internalPrescriptionId: number | null = null;

    if (prescriptionId) {
      const { rows: rxRows } = await pool.query<{ id: number }>(
        'SELECT id FROM prescriptions WHERE dentira_prescription_id = $1 LIMIT 1',
        [prescriptionId],
      );
      internalPrescriptionId = rxRows[0]?.id ?? null;
    }

    // 4. Calculate tax (flat 9.75% on subTotal)
    const taxCents = Math.round(order.subTotal * TAX_RATE);

    // 5. Persist order
    const { rows: orderRows } = await pool.query<{ id: number }>(
      `INSERT INTO orders
         (dentira_order_id, prescription_id, status, subtotal_cents, tax_cents, raw_payload_jsonb)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        order.id,
        internalPrescriptionId,
        'CREATED',
        order.subTotal,
        taxCents,
        JSON.stringify(order),
      ],
    );

    const internalOrderId = orderRows[0].id;

    // 6. Persist order items
    for (const item of order.orderItems) {
      await pool.query(
        `INSERT INTO order_items (order_id, dentira_variant_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4)`,
        [internalOrderId, item.variantId, item.quantity, item.unitPrice],
      );
    }

    log.info({ internalOrderId, taxCents }, 'Order and items persisted');

    // 7. Acknowledge with Dentira Care
    await updateVendorOrder({
      vendorOrderId: order.id,
      status: 'ACKNOWLEDGED',
      taxAmount: taxCents,
    });

    await pool.query(
      'UPDATE orders SET status = $1, acknowledged_at = NOW() WHERE id = $2',
      ['ACKNOWLEDGED', internalOrderId],
    );

    log.info('Order acknowledged with Dentira');

    // 8. Demo-mode simulation of SHIPPED and DELIVERED
    if (config.DEMO_MODE) {
      // SHIPPED in 30 seconds
      setTimeout(() => {
        simulateShipped(order.id, internalOrderId).catch(err =>
          logger.error({ err, orderId: order.id }, 'simulateShipped failed'),
        );
      }, 30_000);

      // DELIVERED in 60 seconds
      setTimeout(() => {
        simulateDelivered(order.id, internalOrderId).catch(err =>
          logger.error({ err, orderId: order.id }, 'simulateDelivered failed'),
        );
      }, 60_000);

      log.info('DEMO_MODE: SHIPPED scheduled in 30s, DELIVERED in 60s');
    }

    await markWebhookProcessed(webhookLogId);
    log.info('Order processing complete');
  } catch (err) {
    log.error({ err }, 'Order processing failed');
    await pool.query(
      'UPDATE webhook_log SET error_message = $1 WHERE id = $2',
      [String(err), webhookLogId],
    );
    throw err; // re-throw so pg-boss can retry
  }
}

async function simulateShipped(dentiraOrderId: string, internalOrderId: number) {
  const trackingInfo = `https://fedex.com/track/DEMO-${Date.now()}`;
  await updateVendorOrder({ vendorOrderId: dentiraOrderId, status: 'SHIPPED', trackingInfo });
  await pool.query(
    'UPDATE orders SET status = $1, tracking_info = $2, shipped_at = NOW() WHERE id = $3',
    ['SHIPPED', trackingInfo, internalOrderId],
  );
  logger.info({ dentiraOrderId }, 'DEMO: order marked SHIPPED');
}

async function simulateDelivered(dentiraOrderId: string, internalOrderId: number) {
  await updateVendorOrder({ vendorOrderId: dentiraOrderId, status: 'DELIVERED' });
  await pool.query(
    'UPDATE orders SET status = $1, delivered_at = NOW() WHERE id = $2',
    ['DELIVERED', internalOrderId],
  );
  logger.info({ dentiraOrderId }, 'DEMO: order marked DELIVERED');
}

async function markWebhookProcessed(webhookLogId: number) {
  await pool.query('UPDATE webhook_log SET processed = TRUE WHERE id = $1', [webhookLogId]);
}
