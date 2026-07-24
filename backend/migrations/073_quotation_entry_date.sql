ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS entry_date DATE;

UPDATE quotations
SET entry_date = created_at::date
WHERE entry_date IS NULL;

ALTER TABLE quotations
  ALTER COLUMN entry_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN entry_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotations_entry_date
  ON quotations(entry_date DESC);
