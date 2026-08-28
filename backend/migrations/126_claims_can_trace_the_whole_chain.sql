-- A claim is raised about something that went wrong somewhere along a chain:
-- the order was taken, a purchase order sent it to a supplier, a shipment
-- carried it, and only then did the customer see a problem. Until now a claim
-- could name the order and the invoice but not the PO or the parcel, so
-- "damaged in transit" and "printed wrong" pointed at the same place.
--
-- Additive throughout. Nothing is dropped, renamed or emptied; every column and
-- index here is created only if it is missing, so this is safe to re-run.
--
-- Nullable on purpose: a claim can be raised before a PO exists and before
-- anything ships. The chain is recorded where it is known, not demanded.

-- ── claims: reach the procurement and shipping side ──
ALTER TABLE claims ADD COLUMN IF NOT EXISTS purchase_order_id UUID;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS shipment_id       UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_purchase_order_id_fkey') THEN
    ALTER TABLE claims ADD CONSTRAINT claims_purchase_order_id_fkey
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_shipment_id_fkey') THEN
    ALTER TABLE claims ADD CONSTRAINT claims_shipment_id_fkey
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN claims.purchase_order_id IS
  'Which procurement PO the complaint is about. A sales order may have several.';
COMMENT ON COLUMN claims.shipment_id IS
  'Which parcel the complaint is about. A PO may have several.';

-- ── claims.status: the workflow has a "Need More Info" state ──
-- A reviewer can send a claim back for detail, and that is a state the claim
-- sits in, not just a decision that was made once.
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims ADD CONSTRAINT claims_status_check CHECK (status IN
  ('Draft','Raised','Under Review','Need More Info','Approved','Rejected','Refunded','Closed'));

-- ── claim_items: name the PO line as well as the order line ──
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS purchase_order_item_id    UUID;
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS purchase_order_item_table VARCHAR(30);

-- The PO side has as many line tables as the order side, so the table is named
-- beside the id rather than adding a foreign key that could only fit one of them.
ALTER TABLE claim_items DROP CONSTRAINT IF EXISTS claim_items_po_table_check;
ALTER TABLE claim_items ADD CONSTRAINT claim_items_po_table_check
  CHECK (purchase_order_item_table IS NULL OR purchase_order_item_table IN
    ('purchase_order_items','po_dtf_items','po_apparel_items','po_gangsheet_lines','po_services'));

COMMENT ON COLUMN claim_items.purchase_order_item_table IS
  'Which PO line table purchase_order_item_id belongs to.';

-- ── refunds: money leaving, recorded separately from the money that came in ──
-- A refund never edits the original payment. It is its own transaction, linked
-- back to the claim that justified it and to the payment it reverses, so the
-- ledger keeps both halves.
CREATE TABLE IF NOT EXISTS refunds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number VARCHAR(30) NOT NULL UNIQUE,
  claim_id      UUID REFERENCES claims(id)          ON DELETE SET NULL,
  customer_id   UUID REFERENCES customers(id)       ON DELETE RESTRICT,
  order_id      UUID REFERENCES orders(id)          ON DELETE SET NULL,
  invoice_id    UUID REFERENCES invoices(id)        ON DELETE SET NULL,
  payment_id    UUID REFERENCES payments(id)        ON DELETE SET NULL,
  amount        NUMERIC(14,2) NOT NULL,
  refund_method VARCHAR(40),
  status        VARCHAR(30) NOT NULL DEFAULT 'Pending',
  reference_no  VARCHAR(120),
  notes         TEXT,
  processed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT refunds_status_check CHECK (status IN ('Pending','Processing','Completed','Failed','Cancelled')),
  CONSTRAINT refunds_amount_check CHECK (amount > 0)
);

COMMENT ON TABLE refunds IS
  'Money returned to a customer. Its own transaction — the original payment is never altered.';

-- ── indexes ──
CREATE INDEX IF NOT EXISTS idx_claims_purchase_order ON claims (purchase_order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_shipment       ON claims (shipment_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claim_items_order_item ON claim_items (order_item_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_po_item    ON claim_items (purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_refunds_claim    ON refunds (claim_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_customer ON refunds (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_order    ON refunds (order_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_invoice  ON refunds (invoice_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_payment  ON refunds (payment_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_status   ON refunds (status)      WHERE deleted_at IS NULL;
