-- 083_payments_module.sql
-- Promote `payments` from an invoice-only child table into a first-class
-- Payments record that can also stand against a sales order.
--
-- Adds: a unique human payment number, customer + order links, a customer name
-- snapshot, and a status. `invoice_id` becomes nullable so a payment can be
-- recorded directly against an order; invoice-linked payments keep their
-- existing behaviour (the sync_invoice_payment_totals trigger already guards
-- with COALESCE(NEW.invoice_id, OLD.invoice_id), and a NULL simply matches no
-- invoice row).
--
-- Additive + idempotent + schema-only. The backfill of existing rows runs as a
-- separate owner-approved data script (Constitution §6/§8).

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_number VARCHAR(30),                      -- PAY-YYYY-NNNN
  ADD COLUMN IF NOT EXISTS customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id       UUID REFERENCES orders(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name  VARCHAR(255),                     -- snapshot at capture time
  ADD COLUMN IF NOT EXISTS status         VARCHAR(20) DEFAULT 'Completed',  -- Completed | Pending | Failed
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- A payment may now belong to an order instead of an invoice.
ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;

-- One payment number per payment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_number_uniq
  ON payments (payment_number) WHERE payment_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_order    ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_date     ON payments (payment_date DESC);
