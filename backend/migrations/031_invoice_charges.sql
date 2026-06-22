-- Add payment and charge fields to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_terms    VARCHAR(50)   DEFAULT 'Due on Receipt',
  ADD COLUMN IF NOT EXISTS payment_method   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS currency         VARCHAR(10)   DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS rush_services    NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_charges NUMERIC(12,2) DEFAULT 0;
