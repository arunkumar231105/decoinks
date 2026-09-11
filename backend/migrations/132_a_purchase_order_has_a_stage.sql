-- 132_a_purchase_order_has_a_stage.sql
-- Additive: a purchase order carries two statuses, the way a sales order does
-- (103_orders_stage_and_process_status.sql).
--
--   po_stage        — where the document is: Draft, Saved, Sent
--   process status  — where the work is: PO Issued, In Production, Shipped,
--                     Delivered. Not stored: it is read off the PO's status and
--                     its parcel on every request, so it cannot go stale the way
--                     purchase_orders.status did (137 POs had a delivered parcel
--                     and only 69 read Closed).
--
-- `purchase_orders.status` stays as it is; every reader, the state machine and
-- the fulfilment portal keep using it. A row with no po_stage reads Draft while
-- its status is Draft and Sent once it has moved past it.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_stage VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_po_stage_check') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_stage_check
      CHECK (po_stage IS NULL OR po_stage IN ('Draft','Saved','Sent')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_po_stage_check' AND NOT convalidated) THEN
    ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_po_stage_check;
  END IF;
END $$;
