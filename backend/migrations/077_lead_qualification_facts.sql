-- Add the factual qualification flags displayed by the lead details drawer.
-- Existing flags and score fields remain unchanged.
ALTER TABLE lead_qualifications
  ADD COLUMN IF NOT EXISTS customer_responded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS human_engaged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS product_identified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quantity_discussed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quote_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mockup_requested BOOLEAN NOT NULL DEFAULT FALSE;
