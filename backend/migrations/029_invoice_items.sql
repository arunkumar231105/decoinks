-- Add order_type to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_type VARCHAR(20);

-- Invoice line items (for direct invoices not linked to a quotation)
CREATE TABLE IF NOT EXISTS invoice_items (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id    UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description   TEXT,
  qty           NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  artwork_count INTEGER       NOT NULL DEFAULT 0,
  sort_order    INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
