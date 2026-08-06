-- 091_quotations_invoices_soft_delete.sql
-- Bring quotations + invoices in line with the rest of the modules
-- (customers/orders/purchase_orders/shipments) which already carry a
-- deleted_at column and treat NULL as "still there".
--
-- Additive/schema-only. No data touched.

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_quotations_deleted_at
  ON quotations (deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at
  ON invoices (deleted_at) WHERE deleted_at IS NULL;
