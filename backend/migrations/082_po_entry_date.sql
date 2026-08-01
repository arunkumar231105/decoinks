-- 082_po_entry_date.sql
-- Separate the ENTRY date (day the PO was uploaded/entered into the system)
-- from the PO date (the real purchase-order date from the source documents),
-- mirroring what 081 did for sales orders.
--
-- purchase_orders.order_date already holds the true PO date and is NOT touched.
-- Additive + idempotent + nullable + schema-only; the backfill runs as a
-- separate owner-approved data step (Constitution §6/§8).

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS entry_date DATE;  -- day the PO was entered/uploaded
