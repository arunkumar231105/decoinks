-- ============================================================
--  007_orders_pipeline_columns.sql
--  Adds: invoice_id FK, gangsheet_url, artwork_locations,
--        shipped_at
--  Adds enum value: 'QC' to order_status
-- ============================================================

-- ── 1. Replace order_status enum to add 'QC' ─────────────────

CREATE TYPE order_status_new AS ENUM (
  'Draft',
  'Confirmed',
  'In Production',
  'QC',
  'Ready to Ship',
  'Shipped',
  'Delivered',
  'Cancelled'
);

ALTER TABLE orders
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE orders
  ALTER COLUMN status TYPE order_status_new
  USING (status::text::order_status_new);

DROP TYPE order_status;
ALTER TYPE order_status_new RENAME TO order_status;

ALTER TABLE orders
  ALTER COLUMN status SET DEFAULT 'Draft'::order_status;

-- ── 2. Add pipeline columns ───────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_id        UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS gangsheet_url     TEXT,
  ADD COLUMN IF NOT EXISTS artwork_locations JSONB,
  ADD COLUMN IF NOT EXISTS shipped_at        TIMESTAMPTZ;

-- ── 3. Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_invoice_id
  ON orders(invoice_id) WHERE invoice_id IS NOT NULL;
