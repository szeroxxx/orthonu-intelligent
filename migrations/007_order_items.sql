-- Line items from Dentira Care order webhook payload
CREATE TABLE IF NOT EXISTS order_items (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dentira_variant_id  TEXT    NOT NULL,
  quantity            INTEGER NOT NULL,
  unit_price_cents    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
