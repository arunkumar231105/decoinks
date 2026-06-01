-- ============================================================
--  014_quotations_order_type.sql
--  Adds nullable order_type to quotations so the pipeline
--  auto-trigger can create a typed order when an invoice is paid.
-- ============================================================

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS order_type order_type;
