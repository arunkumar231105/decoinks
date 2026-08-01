-- 081_orders_entry_date.sql
-- Separate the ENTRY date (day the record was uploaded into the system) from
-- the SALES ORDER date (the real PO/order date from the source data).
--
-- Until now: order_date = the real sales-order date (correct), and created_at =
-- the upload timestamp. This adds an explicit entry_date so both are first-class
-- and can be shown/edited independently. Backfilled from created_at so existing
-- rows keep their true upload date.
--
-- Additive + idempotent + nullable + schema-only. order_date is NOT touched.
-- The backfill (entry_date := created_at::date) is done by a separate,
-- owner-approved data script — never inside a migration (Constitution §6/§8).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS entry_date DATE;  -- day the order was entered/uploaded
