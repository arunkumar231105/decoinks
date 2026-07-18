-- Preserve every customer-facing New Invoice field in the invoice snapshot so
-- print/PDF previews do not have to reconstruct current values from a quote.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_notes   TEXT,
  ADD COLUMN IF NOT EXISTS sales_agent_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS rush_charges     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type    VARCHAR(12) NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS discount_value   NUMERIC(12,2) NOT NULL DEFAULT 0;
