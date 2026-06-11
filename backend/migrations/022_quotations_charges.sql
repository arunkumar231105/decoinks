-- 022_quotations_charges.sql
-- Add shipping, rush services, payment_terms and customer notes to quotations table

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS estimated_shipping NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rush_services      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms      VARCHAR(50)   DEFAULT 'Due on Receipt',
  ADD COLUMN IF NOT EXISTS customer_notes     TEXT;
