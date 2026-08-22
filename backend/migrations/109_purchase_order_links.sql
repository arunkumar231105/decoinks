-- 109_purchase_order_links.sql
--
-- The purchase order's four tables, like the sales order's, are already here and
-- already match the owner's specification field for field:
--
--   purchase_orders      header, 72 fields, 125 live POs
--   po_apparel_items     style + colour + size + quantity + supplier cost, and it
--                        already carries source_sales_order_apparel_item_id — the
--                        link back to the sales order line the specification asks
--                        for
--   po_item_artworks     purchase_order_id, po_apparel_item_id, artwork_id,
--                        artwork_version_id, placement, size, quantity,
--                        application_notes — an exact match
--   po_gangsheet_lines   gangsheet_id, gangsheet_version_id, quantity, supplier
--                        unit and line cost, notes — an exact match
--
-- So no fifth table is built. What this adds is the five header fields the
-- specification has that the header does not, and the two foreign keys the
-- gangsheet lines were missing.
--
-- THE GANGSHEET LINES POINTED AT NOTHING. gangsheet_id and gangsheet_version_id
-- were plain UUID columns with no foreign key, so a line could name a gangsheet
-- that does not exist and the database would accept it. They now reference
-- master_gangsheets (Gangsheet Main) and child_gangsheets (its versions), which
-- is what the specification's "Gangsheet Main" and "production gangsheet
-- version" are in this schema.
--
-- ON required_dispatch_date. The header keeps the dispatch date as free text in
-- required_dispatch_text, and 87 of the 125 POs have one — written as
-- "25-Jun-2026" on 49 of them, "31-07-2026" on 12, something else on 19, and on
-- 7 as a number pair like "04-08-2026" that could be the fourth of August or the
-- eighth of April. A real date column is added; the text is NOT parsed into it
-- here. A migration changes shape, not meaning, and seven of these dates cannot
-- be read without someone who knows which the shop meant.
--
-- ON supplier_notes AND internal_notes. The header has one `notes` column, used
-- on 69 POs, and nothing says whether what is in it was meant for the supplier
-- or for Decoinks. Both columns are added empty rather than guessing; `notes`
-- keeps its contents until someone decides where they belong.
--
-- Every column added is nullable, so all 169 existing rows stay valid.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS need_by_date           DATE,
  ADD COLUMN IF NOT EXISTS required_dispatch_date DATE,
  ADD COLUMN IF NOT EXISTS shipping_address_id    UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_notes         TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes         TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_shipping_address ON purchase_orders(shipping_address_id)
  WHERE shipping_address_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_dispatch_due ON purchase_orders(required_dispatch_date)
  WHERE required_dispatch_date IS NOT NULL AND deleted_at IS NULL;

-- ── Gangsheet lines: point them at the gangsheets they name ─────────────────
-- RESTRICT rather than CASCADE: a gangsheet that a supplier has been told to
-- print must not vanish because someone tidied the gangsheet library.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_gangsheet_lines_gangsheet_id_fkey') THEN
    ALTER TABLE po_gangsheet_lines
      ADD CONSTRAINT po_gangsheet_lines_gangsheet_id_fkey
      FOREIGN KEY (gangsheet_id) REFERENCES master_gangsheets(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_gangsheet_lines_gangsheet_version_id_fkey') THEN
    ALTER TABLE po_gangsheet_lines
      ADD CONSTRAINT po_gangsheet_lines_gangsheet_version_id_fkey
      FOREIGN KEY (gangsheet_version_id) REFERENCES child_gangsheets(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_gangsheet_lines_gangsheet ON po_gangsheet_lines(gangsheet_id);
CREATE INDEX IF NOT EXISTS idx_po_gangsheet_lines_version   ON po_gangsheet_lines(gangsheet_version_id);
CREATE INDEX IF NOT EXISTS idx_po_gangsheet_lines_po        ON po_gangsheet_lines(purchase_order_id);

-- A supplier's copy count has to be a real number of copies.
ALTER TABLE po_gangsheet_lines DROP CONSTRAINT IF EXISTS chk_po_gangsheet_lines_quantity;
ALTER TABLE po_gangsheet_lines ADD CONSTRAINT chk_po_gangsheet_lines_quantity CHECK (quantity IS NULL OR quantity > 0);
