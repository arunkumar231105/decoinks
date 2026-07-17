-- Idempotent source links for the historical DTF commercial document chain.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_entry_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS source_po_number VARCHAR(80);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_entry_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS source_po_number VARCHAR(80);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_entry_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS source_po_number VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_source_entry_key
  ON quotations(source_entry_key) WHERE source_entry_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_source_entry_key
  ON orders(source_entry_key) WHERE source_entry_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_source_entry_key
  ON invoices(source_entry_key) WHERE source_entry_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders(customer_id) WHERE customer_id IS NOT NULL;
