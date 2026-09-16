-- 142: a purchase order carries what the SUPPLIER charges.
--
-- A purchase order is the shop buying from a factory (DIGI, TSI Transfers).
-- Until now it carried the customer's side of the job: its total was the sales
-- order's value, its lines the customer's prices, its payment_status whether the
-- customer had paid — and the Fulfillment Portal showed those numbers to the
-- factory. What the factory charges us, the factory's bills and what we have
-- paid them had nowhere to live. The owner, 16 Sep 2026: the PO takes only the
-- work from the sales order; its money is the supplier's.
--
-- Additive only. No column is dropped or re-purposed; the old customer-money
-- columns stay as history and new purchase orders stop writing them.

-- ── What the supplier charges, on the PO and on each line ──────────────────
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_unit_cost NUMERIC(12,2);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_line_cost NUMERIC(12,2)
  GENERATED ALWAYS AS (ROUND(supplier_unit_cost * qty_ordered, 2)) STORED;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_goods_cost   NUMERIC(12,2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_setup_cost   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_freight_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_discount     NUMERIC(12,2) NOT NULL DEFAULT 0;
-- Goods + setup/print + freight − discount; empty until any cost is known.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_total_cost NUMERIC(12,2)
  GENERATED ALWAYS AS (
    CASE WHEN supplier_goods_cost IS NULL AND supplier_setup_cost = 0 AND supplier_freight_cost = 0 THEN NULL
         ELSE ROUND(COALESCE(supplier_goods_cost, 0) + supplier_setup_cost + supplier_freight_cost - supplier_discount, 2)
    END) STORED;
-- Kept by the bills and payments below, never typed.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_billed_amount  NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_paid_amount    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_payment_status VARCHAR(20) NOT NULL DEFAULT 'Not Billed';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_poi_supplier_unit_cost') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT chk_poi_supplier_unit_cost
      CHECK (supplier_unit_cost IS NULL OR supplier_unit_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_supplier_costs') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_supplier_costs CHECK (
      (supplier_goods_cost IS NULL OR supplier_goods_cost >= 0)
      AND supplier_setup_cost >= 0 AND supplier_freight_cost >= 0 AND supplier_discount >= 0
      AND supplier_discount <= COALESCE(supplier_goods_cost, 0) + supplier_setup_cost + supplier_freight_cost);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_supplier_payment_status') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_supplier_payment_status
      CHECK (supplier_payment_status IN ('Not Billed', 'Unpaid', 'Partial', 'Paid'));
  END IF;
END $$;

-- ── The supplier's bills ────────────────────────────────────────────────────
-- One bill may cover one purchase order or a week of them.
CREATE TABLE IF NOT EXISTS supplier_bills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  UUID NOT NULL REFERENCES suppliers(id),
  bill_number  VARCHAR(60) NOT NULL,              -- the supplier's own invoice number
  bill_date    DATE NOT NULL,
  due_date     DATE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  amount_paid  NUMERIC(12,2) NOT NULL DEFAULT 0,
  status       VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Partial', 'Paid', 'Void')),
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  file_url     TEXT,
  notes        TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bills_number ON supplier_bills (supplier_id, bill_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills (supplier_id);

CREATE TABLE IF NOT EXISTS supplier_bill_pos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id    UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  po_id      UUID NOT NULL REFERENCES purchase_orders(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bill_id, po_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_pos_po ON supplier_bill_pos (po_id);

-- ── What we pay the supplier ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number       VARCHAR(30) UNIQUE,
  supplier_id          UUID NOT NULL REFERENCES suppliers(id),
  payment_date         DATE NOT NULL,
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method               VARCHAR(50) NOT NULL,
  reference            VARCHAR(120),
  paid_from_account_id UUID REFERENCES payment_accounts(id),
  notes                TEXT,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments (supplier_id);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  bill_id    UUID NOT NULL REFERENCES supplier_bills(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, bill_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_bill ON supplier_payment_allocations (bill_id);

DROP TRIGGER IF EXISTS trg_supplier_bills_updated_at ON supplier_bills;
CREATE TRIGGER trg_supplier_bills_updated_at BEFORE UPDATE ON supplier_bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_payments_updated_at ON supplier_payments;
CREATE TRIGGER trg_supplier_payments_updated_at BEFORE UPDATE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── One supplier per bill, per payment, per PO ──────────────────────────────
CREATE OR REPLACE FUNCTION supplier_money_same_supplier()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bill_supplier UUID;
  v_other         UUID;
BEGIN
  SELECT supplier_id INTO v_bill_supplier FROM supplier_bills WHERE id = NEW.bill_id;
  IF TG_TABLE_NAME = 'supplier_bill_pos' THEN
    SELECT supplier_id INTO v_other FROM purchase_orders WHERE id = NEW.po_id;
    IF v_other IS DISTINCT FROM v_bill_supplier THEN
      RAISE EXCEPTION 'That purchase order is not from the supplier who sent this bill' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT supplier_id INTO v_other FROM supplier_payments WHERE id = NEW.payment_id;
    IF v_other IS DISTINCT FROM v_bill_supplier THEN
      RAISE EXCEPTION 'That payment was made to a different supplier than the bill' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_supplier_bill_pos_same_supplier ON supplier_bill_pos;
CREATE TRIGGER trg_supplier_bill_pos_same_supplier BEFORE INSERT OR UPDATE ON supplier_bill_pos
  FOR EACH ROW EXECUTE FUNCTION supplier_money_same_supplier();
DROP TRIGGER IF EXISTS trg_supplier_allocations_same_supplier ON supplier_payment_allocations;
CREATE TRIGGER trg_supplier_allocations_same_supplier BEFORE INSERT OR UPDATE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION supplier_money_same_supplier();

-- ── Nothing allocated beyond what exists (checked at commit) ────────────────
CREATE OR REPLACE FUNCTION supplier_money_within_amounts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bill    UUID;
  v_payment UUID;
  v_amount  NUMERIC(12,2);
  v_sum     NUMERIC(12,2);
BEGIN
  IF TG_TABLE_NAME = 'supplier_bills' THEN
    v_bill := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'supplier_payments' THEN
    v_payment := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'supplier_bill_pos' THEN
    v_bill := COALESCE(NEW.bill_id, OLD.bill_id);
  ELSE
    v_bill := COALESCE(NEW.bill_id, OLD.bill_id);
    v_payment := COALESCE(NEW.payment_id, OLD.payment_id);
  END IF;

  IF v_bill IS NOT NULL THEN
    SELECT amount INTO v_amount FROM supplier_bills WHERE id = v_bill;
    IF v_amount IS NOT NULL THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_sum FROM supplier_bill_pos WHERE bill_id = v_bill;
      IF v_sum > v_amount THEN
        RAISE EXCEPTION 'Purchase orders on this bill come to %, more than the bill''s %', v_sum, v_amount USING ERRCODE = 'check_violation';
      END IF;
      SELECT COALESCE(SUM(amount), 0) INTO v_sum FROM supplier_payment_allocations WHERE bill_id = v_bill;
      IF v_sum > v_amount THEN
        RAISE EXCEPTION 'Payments against this bill come to %, more than the bill''s %', v_sum, v_amount USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF v_payment IS NOT NULL THEN
    SELECT amount INTO v_amount FROM supplier_payments WHERE id = v_payment;
    IF v_amount IS NOT NULL THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_sum FROM supplier_payment_allocations WHERE payment_id = v_payment;
      IF v_sum > v_amount THEN
        RAISE EXCEPTION 'This payment is applied to bills totalling %, more than the payment''s %', v_sum, v_amount USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_supplier_bills_within ON supplier_bills;
CREATE CONSTRAINT TRIGGER trg_supplier_bills_within AFTER INSERT OR UPDATE ON supplier_bills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION supplier_money_within_amounts();
DROP TRIGGER IF EXISTS trg_supplier_payments_within ON supplier_payments;
CREATE CONSTRAINT TRIGGER trg_supplier_payments_within AFTER INSERT OR UPDATE ON supplier_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION supplier_money_within_amounts();
DROP TRIGGER IF EXISTS trg_supplier_bill_pos_within ON supplier_bill_pos;
CREATE CONSTRAINT TRIGGER trg_supplier_bill_pos_within AFTER INSERT OR UPDATE ON supplier_bill_pos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION supplier_money_within_amounts();
DROP TRIGGER IF EXISTS trg_supplier_allocations_within ON supplier_payment_allocations;
CREATE CONSTRAINT TRIGGER trg_supplier_allocations_within AFTER INSERT OR UPDATE ON supplier_payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION supplier_money_within_amounts();

-- ── Paid so far: bill, then each PO it covers ───────────────────────────────
CREATE OR REPLACE FUNCTION recalc_po_supplier_payment(p_po UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_billed NUMERIC(12,2);
  v_paid   NUMERIC(12,2);
  v_status TEXT;
BEGIN
  IF p_po IS NULL THEN RETURN; END IF;
  -- A PO's share of a part-paid bill is paid in the bill's proportion.
  SELECT COALESCE(SUM(bp.amount), 0),
         COALESCE(SUM(ROUND(bp.amount * LEAST(b.amount_paid / NULLIF(b.amount, 0), 1), 2)), 0)
    INTO v_billed, v_paid
    FROM supplier_bill_pos bp
    JOIN supplier_bills b ON b.id = bp.bill_id AND b.deleted_at IS NULL AND b.status <> 'Void'
   WHERE bp.po_id = p_po;
  v_status := CASE WHEN v_billed = 0 THEN 'Not Billed'
                   WHEN v_paid >= v_billed THEN 'Paid'
                   WHEN v_paid > 0 THEN 'Partial'
                   ELSE 'Unpaid' END;
  UPDATE purchase_orders
     SET supplier_billed_amount = v_billed, supplier_paid_amount = v_paid, supplier_payment_status = v_status
   WHERE id = p_po
     AND (supplier_billed_amount IS DISTINCT FROM v_billed OR supplier_paid_amount IS DISTINCT FROM v_paid
          OR supplier_payment_status IS DISTINCT FROM v_status);
END;
$$;

CREATE OR REPLACE FUNCTION recalc_supplier_bill(p_bill UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_paid NUMERIC(12,2);
BEGIN
  IF p_bill IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(a.amount), 0) INTO v_paid
    FROM supplier_payment_allocations a
    JOIN supplier_payments p ON p.id = a.payment_id AND p.deleted_at IS NULL
   WHERE a.bill_id = p_bill;
  UPDATE supplier_bills b
     SET amount_paid = v_paid,
         status = CASE WHEN b.status = 'Void' THEN 'Void'
                       WHEN v_paid >= b.amount THEN 'Paid'
                       WHEN v_paid > 0 THEN 'Partial'
                       ELSE 'Unpaid' END
   WHERE b.id = p_bill
     AND (b.amount_paid IS DISTINCT FROM v_paid
          OR b.status IS DISTINCT FROM CASE WHEN b.status = 'Void' THEN 'Void'
                                            WHEN v_paid >= b.amount THEN 'Paid'
                                            WHEN v_paid > 0 THEN 'Partial'
                                            ELSE 'Unpaid' END);
  PERFORM recalc_po_supplier_payment(bp.po_id) FROM supplier_bill_pos bp WHERE bp.bill_id = p_bill;
END;
$$;

CREATE OR REPLACE FUNCTION supplier_money_recalc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 4 THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'supplier_payment_allocations' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM recalc_supplier_bill(OLD.bill_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM recalc_supplier_bill(NEW.bill_id); END IF;
  ELSIF TG_TABLE_NAME = 'supplier_bill_pos' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM recalc_po_supplier_payment(OLD.po_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM recalc_po_supplier_payment(NEW.po_id); END IF;
  ELSIF TG_TABLE_NAME = 'supplier_bills' THEN
    PERFORM recalc_supplier_bill(NEW.id);
  ELSIF TG_TABLE_NAME = 'supplier_payments' THEN
    PERFORM recalc_supplier_bill(a.bill_id) FROM supplier_payment_allocations a WHERE a.payment_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_supplier_allocations_recalc ON supplier_payment_allocations;
CREATE TRIGGER trg_supplier_allocations_recalc AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION supplier_money_recalc();
DROP TRIGGER IF EXISTS trg_supplier_bill_pos_recalc ON supplier_bill_pos;
CREATE TRIGGER trg_supplier_bill_pos_recalc AFTER INSERT OR UPDATE OR DELETE ON supplier_bill_pos
  FOR EACH ROW EXECUTE FUNCTION supplier_money_recalc();
DROP TRIGGER IF EXISTS trg_supplier_bills_recalc ON supplier_bills;
CREATE TRIGGER trg_supplier_bills_recalc AFTER UPDATE OF amount, status, deleted_at ON supplier_bills
  FOR EACH ROW EXECUTE FUNCTION supplier_money_recalc();
DROP TRIGGER IF EXISTS trg_supplier_payments_recalc ON supplier_payments;
CREATE TRIGGER trg_supplier_payments_recalc AFTER UPDATE OF amount, deleted_at ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION supplier_money_recalc();

-- ── Artwork on a PO line: linked, not copied ────────────────────────────────
-- po_item_artworks could only point at the older po_apparel_items/po_dtf_items.
-- Purchase orders raised from sales orders write purchase_order_items, so a link
-- to those is added (item_type 'PO_ITEM'). The table held no rows.
ALTER TABLE po_item_artworks ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID
  REFERENCES purchase_order_items(id) ON DELETE CASCADE;
ALTER TABLE po_item_artworks ALTER COLUMN po_apparel_item_id DROP NOT NULL;
ALTER TABLE po_item_artworks DROP CONSTRAINT IF EXISTS chk_po_item_artworks_target;
ALTER TABLE po_item_artworks ADD CONSTRAINT chk_po_item_artworks_target CHECK (
     (item_type IS NULL AND po_apparel_item_id IS NOT NULL AND po_dtf_item_id IS NULL AND purchase_order_item_id IS NULL)
  OR (item_type = 'APPAREL' AND po_apparel_item_id IS NOT NULL AND po_dtf_item_id IS NULL AND purchase_order_item_id IS NULL)
  OR (item_type = 'DTF_TRANSFER' AND po_dtf_item_id IS NOT NULL AND po_apparel_item_id IS NULL AND purchase_order_item_id IS NULL)
  OR (item_type = 'PO_ITEM' AND purchase_order_item_id IS NOT NULL AND po_apparel_item_id IS NULL AND po_dtf_item_id IS NULL));
CREATE INDEX IF NOT EXISTS idx_po_item_artworks_poi ON po_item_artworks (purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL;
