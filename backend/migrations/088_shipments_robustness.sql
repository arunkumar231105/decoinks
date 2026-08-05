-- 088_shipments_robustness.sql
-- Bring shipments up to the same shape as payments after 086:
--
-- 1. shipment_orders  — a join so one parcel can cover several orders. The
--    combined-billing case (TSI 63/64/65/67, plus Robert Farrar 20-Jul + 23-Jul)
--    already exists in the data as duplicate tracking numbers on separate order
--    rows. shipments.order_id stays as the primary link for list display; the
--    full breakdown lives in the join table.
--
-- 2. deleted_at        — soft delete, matching orders/customers/invoices/POs.
--                        Shipping records are money and audit trail; hard
--                        delete has already cost us data once.
--
-- 3. is_return         — a shipped-from-us-to-us / returned label flag, so the
--                        Corona 92881 pattern the owner called "not ours" is
--                        classified rather than deleted.
--
-- 4. tracking_number   — UNIQUE index. Not enforced today; a Shippo re-import
--                        would silently create duplicates.
--
-- 5. order_id XOR po_id — a shipment fulfils either a sales order or a PO,
--                        never both. Enforce it.
--
-- Existing rows are untouched: every column is additive/nullable, indexes are
-- IF NOT EXISTS, the XOR check only enforces "not both", not "at least one",
-- so nulls-both rows (unlinked shipments) are still allowed.

-- ── 1. join table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipment_orders (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id  UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES orders(id)    ON DELETE CASCADE,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipment_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_orders_shipment ON shipment_orders (shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_orders_order    ON shipment_orders (order_id);
-- Exactly one primary order per shipment (the one shipments.order_id points at).
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_orders_primary
  ON shipment_orders (shipment_id) WHERE is_primary;

-- Seed every existing single-order shipment as its own primary allocation.
-- Combined-parcel corrections come from the app afterwards; this just makes
-- the join table agree with what the shipments table already says.
INSERT INTO shipment_orders (shipment_id, order_id, is_primary)
SELECT id, order_id, TRUE FROM shipments
 WHERE order_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM shipment_orders so WHERE so.shipment_id = shipments.id);

-- ── 2. soft delete ──────────────────────────────────────────────────────────
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_shipments_deleted_at ON shipments (deleted_at) WHERE deleted_at IS NULL;

-- ── 3. return flag ──────────────────────────────────────────────────────────
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS is_return BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. tracking uniqueness ──────────────────────────────────────────────────
-- Partial index so a NULL tracking number (draft rows) does not clash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_tracking_uniq
  ON shipments (tracking_number)
  WHERE tracking_number IS NOT NULL AND deleted_at IS NULL;

-- ── 5. order XOR po (not both) ──────────────────────────────────────────────
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS chk_shipments_target_xor;
ALTER TABLE shipments ADD  CONSTRAINT chk_shipments_target_xor
  CHECK (order_id IS NULL OR po_id IS NULL);
