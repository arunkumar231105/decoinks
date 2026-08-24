-- 115_every_new_line_remembers_its_old_one.sql
--
-- The 836 existing lines are about to be copied into the new tables. Two things
-- have to be true afterwards and stay true: it must be possible to point at any
-- new row and say which old row it came from, and running the move a second
-- time must not be able to duplicate anything.
--
-- A source column on each receiving table gives the first. A unique index on it
-- gives the second — not by the script being careful, but because the database
-- will refuse the second insert. The move is 1:1: every legacy line becomes
-- exactly one new line, which is why a unique index is the right shape for it.
-- If a future change ever needs to split one legacy line into several, that is
-- a new migration and a considered decision, not something a re-run can do by
-- accident.
--
-- The columns are nullable, because a line entered from now on has no legacy
-- row behind it. ON DELETE SET NULL, because removing an old line should not
-- take the new one with it once the legacy tables are eventually retired.

ALTER TABLE quotation_items_apparel   ADD COLUMN IF NOT EXISTS source_quotation_item_id UUID
  REFERENCES quotation_items(id) ON DELETE SET NULL;
ALTER TABLE quotation_items_dtf       ADD COLUMN IF NOT EXISTS source_quotation_item_id UUID
  REFERENCES quotation_items(id) ON DELETE SET NULL;
ALTER TABLE quotation_items_gangsheet ADD COLUMN IF NOT EXISTS source_quotation_item_id UUID
  REFERENCES quotation_items(id) ON DELETE SET NULL;

ALTER TABLE invoice_items_apparel     ADD COLUMN IF NOT EXISTS source_invoice_item_id UUID
  REFERENCES invoice_items(id) ON DELETE SET NULL;
ALTER TABLE invoice_items_dtf         ADD COLUMN IF NOT EXISTS source_invoice_item_id UUID
  REFERENCES invoice_items(id) ON DELETE SET NULL;
ALTER TABLE invoice_items_gangsheet   ADD COLUMN IF NOT EXISTS source_invoice_item_id UUID
  REFERENCES invoice_items(id) ON DELETE SET NULL;

-- One legacy line, one new line — enforced, not merely intended.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_items_apparel_source
  ON quotation_items_apparel(source_quotation_item_id)   WHERE source_quotation_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_items_dtf_source
  ON quotation_items_dtf(source_quotation_item_id)       WHERE source_quotation_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_items_gangsheet_source
  ON quotation_items_gangsheet(source_quotation_item_id) WHERE source_quotation_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_items_apparel_source
  ON invoice_items_apparel(source_invoice_item_id)       WHERE source_invoice_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_items_dtf_source
  ON invoice_items_dtf(source_invoice_item_id)           WHERE source_invoice_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_items_gangsheet_source
  ON invoice_items_gangsheet(source_invoice_item_id)     WHERE source_invoice_item_id IS NOT NULL;

-- The two PO tables already carry source_purchase_order_item_id; they were
-- missing the same guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_apparel_items_source
  ON po_apparel_items(source_purchase_order_item_id) WHERE source_purchase_order_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_dtf_items_source
  ON po_dtf_items(source_purchase_order_item_id)     WHERE source_purchase_order_item_id IS NOT NULL;
