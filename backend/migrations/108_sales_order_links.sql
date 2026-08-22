-- 108_sales_order_links.sql
--
-- The Sales Order's four tables mostly exist already and match the owner's
-- specification field for field:
--
--   orders                header, 64 fields, 126 live orders
--   order_items_apparel   style + colour + SIZE, one row each — 148 rows
--   order_items_dtf       one row per transfer — 262 rows
--   order_item_artworks   already carries item_type, apparel_item_id,
--                         dtf_item_id, artwork_version_id, placement, quantity,
--                         display_order and production_notes, with the same
--                         one-target CHECK the specification describes
--
-- So this does not build a second sales_orders table beside orders. It adds the
-- fields the specification has that the existing tables do not.
--
-- WHAT IS ADDED, AND WHY EACH ONE
--
--  * approved_for_production / approved_by / approved_at — releasing a job to
--    production is recorded nowhere today. There is a lock (locked_at/locked_by)
--    but that seals a finished record; it does not say the work may start.
--
--  * lead_id — orders reach back to the quotation but not to the lead, so the
--    chain lead → quote → invoice → order breaks at the first step.
--
--  * shipping_address_id — the address is free text on the order; this points at
--    the customer's own address instead, matching quotations and invoices.
--
--  * invoice_apparel_item_id / invoice_dtf_item_id — which invoice line each
--    order line came from. This is what lets an invoice stay as billed while the
--    order is fulfilled differently (95 now, 5 backordered), which is the whole
--    reason for keeping the two sets of lines apart.
--
-- WHAT IS DELIBERATELY NOT DONE
--
--  * customer_ref_no is not added: source_po_number already holds the customer's
--    reference and is filled on 125 of 126 orders.
--
--  * need_by_date is not added: required_ship_date already exists for it, and is
--    filled on none of the 126 orders. A second empty column would not help.
--
--  * invoice_id is left nullable. The specification marks it required, but 28 of
--    the 126 live orders have no invoice — they came from imports — and making
--    it required would invalidate all of them.
--
--  * The order_status enum is untouched. The specification's values (Pending
--    Approval, Ready for Production, Completed) differ from the eight in use
--    (Confirmed, Ready to Ship, Delivered, QC), and rewriting an enum is not
--    additive: it would break the status of every existing order. That is a
--    workflow decision for the owner, not something to slip into a migration.
--
-- Every column added is nullable or has a default, so existing rows stay valid.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_address_id     UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_for_production BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at             TIMESTAMPTZ;

-- An approval must say who and when, or claim nothing at all.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_production_approval;
ALTER TABLE orders ADD CONSTRAINT chk_orders_production_approval CHECK (
  approved_for_production = FALSE OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_orders_lead ON orders(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shipping_address ON orders(shipping_address_id) WHERE shipping_address_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_awaiting_release ON orders(approved_for_production)
  WHERE approved_for_production = FALSE AND deleted_at IS NULL;

-- ── Which invoice line each order line came from ────────────────────────────
ALTER TABLE order_items_apparel
  ADD COLUMN IF NOT EXISTS invoice_apparel_item_id UUID REFERENCES invoice_items_apparel(id) ON DELETE SET NULL;
ALTER TABLE order_items_dtf
  ADD COLUMN IF NOT EXISTS invoice_dtf_item_id UUID REFERENCES invoice_items_dtf(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_apparel_source ON order_items_apparel(invoice_apparel_item_id)
  WHERE invoice_apparel_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_dtf_source ON order_items_dtf(invoice_dtf_item_id)
  WHERE invoice_dtf_item_id IS NOT NULL;

-- Fulfilment notes per line, which the specification asks for and the order
-- item tables do not have (production_status is a state, not an instruction).
ALTER TABLE order_items_apparel ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE order_items_dtf     ADD COLUMN IF NOT EXISTS notes TEXT;
