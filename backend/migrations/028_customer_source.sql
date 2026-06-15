-- Add source channel to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS source VARCHAR(100);
