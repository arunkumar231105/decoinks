-- ============================================================
--  007_orders_pipeline_columns_down.sql  (rollback)
-- ============================================================

DROP INDEX IF EXISTS idx_orders_invoice_id;

ALTER TABLE orders
  DROP COLUMN IF EXISTS shipped_at,
  DROP COLUMN IF EXISTS artwork_locations,
  DROP COLUMN IF EXISTS gangsheet_url,
  DROP COLUMN IF EXISTS invoice_id;

-- Restore original order_status enum (without 'QC')
CREATE TYPE order_status_old AS ENUM (
  'Draft', 'Confirmed', 'In Production',
  'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled'
);

ALTER TABLE orders
  ALTER COLUMN status DROP DEFAULT;

-- Rows with 'QC' fall back to 'In Production'
ALTER TABLE orders
  ALTER COLUMN status TYPE order_status_old
  USING (
    CASE status::text
      WHEN 'QC' THEN 'In Production'
      ELSE status::text
    END
  )::order_status_old;

DROP TYPE order_status;
ALTER TYPE order_status_old RENAME TO order_status;

ALTER TABLE orders
  ALTER COLUMN status SET DEFAULT 'Draft'::order_status;
