-- 086_payment_fees_and_allocations.sql
-- Two gaps the owner confirmed after the payments redesign.
--
-- 1. Processor fees. Money is taken through PayPal, Zelle and cards, which keep
--    a cut: a customer sends 100.00 and 96.50 lands. Recording only the gross
--    means the books can never be reconciled against a bank statement.
--    fee_amount holds the cut; net_amount is GENERATED, so what actually landed
--    is always amount - fee and cannot drift from it.
--
-- 2. One payment covering several orders. This already happens in the data —
--    TSI 63/64/65/67 were billed once, combined, for 609.25 — but payments
--    carried a single order_id and could not express it. payment_allocations
--    splits a payment across orders (or invoices), which also gives partial
--    payments for free.
--
--    payments.order_id stays as the primary order for list display; the
--    allocations hold the full breakdown.
--
-- A trigger keeps the allocated total from exceeding the payment. It is a
-- CONSTRAINT trigger so a multi-row insert is checked once the statement
-- completes, not part-way through it.
--
-- Additive + idempotent.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_fee;
ALTER TABLE payments ADD  CONSTRAINT chk_payments_fee
  CHECK (fee_amount >= 0 AND fee_amount <= amount);

-- net_amount is derived, never written: what the account actually received.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2)
    GENERATED ALWAYS AS (amount - fee_amount) STORED;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id        UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id          UUID REFERENCES orders(id)   ON DELETE SET NULL,
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,
  allocated_amount  NUMERIC(12,2) NOT NULL CHECK (allocated_amount > 0),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- An allocation has to point at something.
  CONSTRAINT chk_alloc_target CHECK (order_id IS NOT NULL OR invoice_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_order   ON payment_allocations (order_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_invoice ON payment_allocations (invoice_id);

-- The same order should not be allocated twice on one payment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_alloc_unique_order
  ON payment_allocations (payment_id, order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_payment_allocation_total() RETURNS TRIGGER AS $$
DECLARE
  v_payment UUID := COALESCE(NEW.payment_id, OLD.payment_id);
  v_allocated NUMERIC(12,2);
  v_amount NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_allocated
    FROM payment_allocations WHERE payment_id = v_payment;
  SELECT amount INTO v_amount FROM payments WHERE id = v_payment;

  -- The payment may have been deleted in the same statement (ON DELETE CASCADE).
  IF v_amount IS NOT NULL AND v_allocated > v_amount THEN
    RAISE EXCEPTION 'Allocated % exceeds the payment amount %', v_allocated, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_allocation_total ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_payment_allocation_total
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_allocation_total();
