-- 135_a_parcel_remembers_which_po_it_came_from.sql
-- Additive: a shipment row carries EITHER a sales order or a purchase order
-- (chk_shipments_target_xor), and every one of the 174 parcels in the book
-- carries the sales order — which is what the orders list, the shipments list
-- and the courier sync all read.
--
-- Saving tracking on a purchase order tried to write both at once and was
-- refused by that check ("new row for relation shipments violates check
-- constraint"). The sales order stays the parcel's target; which purchase order
-- it was handed in on is recorded here, so the same PO updates its own parcel
-- instead of creating another on every save.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS from_po_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_from_po_id_fkey') THEN
    ALTER TABLE shipments ADD CONSTRAINT shipments_from_po_id_fkey
      FOREIGN KEY (from_po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_from_po ON shipments (from_po_id) WHERE from_po_id IS NOT NULL;

-- The parcels purchase orders have already created carry the PO in po_id; they
-- are given the new reference too, so they keep being found by it.
UPDATE shipments SET from_po_id = po_id WHERE po_id IS NOT NULL AND from_po_id IS NULL;
