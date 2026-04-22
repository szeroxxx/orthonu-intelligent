-- Orders received from Dentira Care webhooks (patient purchase events)
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  dentira_order_id    TEXT UNIQUE NOT NULL,      -- order.id from webhook payload
  prescription_id     INTEGER REFERENCES prescriptions(id),
  status              TEXT    NOT NULL DEFAULT 'CREATED',
  subtotal_cents      INTEGER NOT NULL DEFAULT 0,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  tracking_info       TEXT,
  raw_payload_jsonb   JSONB,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at     TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_dentira_id     ON orders(dentira_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_prescription   ON orders(prescription_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
