-- Add payment_method to quotations table
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
