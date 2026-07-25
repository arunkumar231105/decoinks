-- 075_po_shipment_fulfillment.sql
-- Capture shipment / fulfillment details directly on the purchase order form.
--
-- Business context: a PO's goods can reach the customer two ways —
--   * "vendor"  → the factory / fulfilment partner ships directly; we just log
--                 their carrier + tracking.
--   * "self"    → the goods come to DecoInks and we ship them out ourselves.
-- The PO form now records that source plus carrier / tracking / dates. On save
-- the PO service mirrors the details into the `shipments` table (linked to the
-- PO and its covered order) so the dashboard "Recent Shipments" list, the
-- Shipments workspace, and the order's shipped status all stay in sync.

-- PO-level shipment attributes (tracking_number / carrier / tracking_notes /
-- shipping_method already exist from earlier migrations).
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS ship_source        VARCHAR(20),   -- 'vendor' | 'self'
  ADD COLUMN IF NOT EXISTS ship_date          DATE,
  ADD COLUMN IF NOT EXISTS estimated_delivery DATE;

-- Direct link from a shipment back to the PO it fulfils, plus who shipped it.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS po_id       UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ship_source VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_shipments_po ON shipments(po_id) WHERE po_id IS NOT NULL;
