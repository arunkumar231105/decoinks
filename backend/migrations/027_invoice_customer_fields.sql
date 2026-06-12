-- Add customer contact/address fields to invoices (for auto-populate from quotation)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name    VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_email    VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contact_number   VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address  TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_address TEXT;
