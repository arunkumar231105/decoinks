-- ============================================================
--  006_invoices_pipeline_columns_down.sql  (rollback)
-- ============================================================

DROP INDEX IF EXISTS idx_invoices_due_date;
DROP INDEX IF EXISTS idx_invoices_quote_id;

ALTER TABLE invoices
  DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS quote_id;

-- Restore original invoice_status enum (without 'Partially Paid')
CREATE TYPE invoice_status_old AS ENUM (
  'Draft', 'Sent', 'Paid', 'Overdue', 'Void'
);

ALTER TABLE invoices
  ALTER COLUMN status DROP DEFAULT;

-- Rows with 'Partially Paid' fall back to 'Sent'
ALTER TABLE invoices
  ALTER COLUMN status TYPE invoice_status_old
  USING (
    CASE status::text
      WHEN 'Partially Paid' THEN 'Sent'
      ELSE status::text
    END
  )::invoice_status_old;

DROP TYPE invoice_status;
ALTER TYPE invoice_status_old RENAME TO invoice_status;

ALTER TABLE invoices
  ALTER COLUMN status SET DEFAULT 'Draft'::invoice_status;
