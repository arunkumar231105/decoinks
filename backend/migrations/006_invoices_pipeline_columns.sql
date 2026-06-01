-- ============================================================
--  006_invoices_pipeline_columns.sql
--  Adds: quote_id FK, sent_at, paid_at
--  Adds enum value: 'Partially Paid' to invoice_status
--
--  NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction,
--  so we use the create-new-type / cast / rename pattern
--  (same approach as 003_artwork_status.sql).
-- ============================================================

-- ── 1. Replace invoice_status enum to add 'Partially Paid' ──

CREATE TYPE invoice_status_new AS ENUM (
  'Draft',
  'Sent',
  'Partially Paid',
  'Paid',
  'Overdue',
  'Void'
);

ALTER TABLE invoices
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE invoices
  ALTER COLUMN status TYPE invoice_status_new
  USING (status::text::invoice_status_new);

DROP TYPE invoice_status;
ALTER TYPE invoice_status_new RENAME TO invoice_status;

ALTER TABLE invoices
  ALTER COLUMN status SET DEFAULT 'Draft'::invoice_status;

-- ── 2. Add pipeline columns ───────────────────────────────────

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS quote_id UUID
        REFERENCES quotations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at  TIMESTAMPTZ;

-- ── 3. Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_quote_id
  ON invoices(quote_id) WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_due_date
  ON invoices(due_date) WHERE due_date IS NOT NULL;
