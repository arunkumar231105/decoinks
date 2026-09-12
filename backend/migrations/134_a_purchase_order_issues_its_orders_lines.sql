-- 134_a_purchase_order_issues_its_orders_lines.sql
-- Additive: one sales order can be bought in several purchase orders, so each
-- PO line records which sales order line it issues and how many of it.
--
--   purchase_orders.po_scope            — 'full' (everything the order has left)
--                                         or 'partial' (a stated number per line)
--   purchase_order_items.source_line_id — the sales order line this line issues
--   purchase_order_items.source_line_table — which of the three line tables it is in
--
-- With the reference on the line, "how many are already issued" is counted from
-- the purchase orders themselves. Nothing keeps a separate running total that
-- could drift, and a deleted PO gives its pieces back on its own.
--
-- Purchase orders raised before this have no reference; they are left as they
-- are and their orders simply start from zero issued.

ALTER TABLE purchase_orders      ADD COLUMN IF NOT EXISTS po_scope           VARCHAR(10);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS source_line_id     UUID;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS source_line_table  VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_po_scope_check') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_scope_check
      CHECK (po_scope IS NULL OR po_scope IN ('full','partial')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_items_source_line_table_check') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT po_items_source_line_table_check
      CHECK (source_line_table IS NULL OR source_line_table IN
        ('order_items_apparel','order_items_dtf','order_items_gangsheet')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_items_source_line
  ON purchase_order_items (source_line_table, source_line_id) WHERE source_line_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_po_scope_check' AND NOT convalidated) THEN
    ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_po_scope_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_items_source_line_table_check' AND NOT convalidated) THEN
    ALTER TABLE purchase_order_items VALIDATE CONSTRAINT po_items_source_line_table_check;
  END IF;
END $$;
