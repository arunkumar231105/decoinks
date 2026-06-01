-- ============================================================
--  010_create_payments_table.sql
--  Creates the payments ledger table for partial payment
--  tracking against invoices.
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID           NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount         NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL,
  reference_no   VARCHAR(100),
  paid_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  recorded_by    UUID           REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_method  ON payments(payment_method);
