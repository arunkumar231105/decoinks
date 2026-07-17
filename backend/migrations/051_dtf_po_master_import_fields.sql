-- Lossless source fields for the April-June 2026 DTF PO master import.
-- Existing operational PO fields remain unchanged; the source key makes the
-- import idempotent and source_po_number preserves duplicate workbook numbers.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_system VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_entry_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS source_po_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_entry_index INTEGER,
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS production_priority VARCHAR(40),
  ADD COLUMN IF NOT EXISTS required_dispatch_text VARCHAR(160),
  ADD COLUMN IF NOT EXISTS print_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS total_gangsheets INTEGER,
  ADD COLUMN IF NOT EXISTS total_artworks INTEGER,
  ADD COLUMN IF NOT EXISTS gangsheet_width VARCHAR(40),
  ADD COLUMN IF NOT EXISTS gangsheet_lengths TEXT,
  ADD COLUMN IF NOT EXISTS payment_received NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS shipping_charge NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS net_product_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS courier_account VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_labels VARCHAR(160),
  ADD COLUMN IF NOT EXISTS packages INTEGER,
  ADD COLUMN IF NOT EXISTS source_payment_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_source_entry_key
  ON purchase_orders(source_entry_key) WHERE source_entry_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_source_po_number
  ON purchase_orders(source_po_number) WHERE source_po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer_id
  ON purchase_orders(customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS source_artwork_no VARCHAR(60),
  ADD COLUMN IF NOT EXISTS image_file_ref VARCHAR(200),
  ADD COLUMN IF NOT EXISTS print_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS gangsheet_lengths TEXT;

CREATE TABLE IF NOT EXISTS po_import_qa_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_system VARCHAR(80) NOT NULL,
  source_po_number VARCHAR(80) NOT NULL,
  issue_type VARCHAR(100) NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_system, source_po_number, issue_type, details)
);
