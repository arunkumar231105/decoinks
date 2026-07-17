-- Type-specific quotation fields used by DTF Transfer and Custom Apparel lines.
-- Additive only: existing quotation and lead data remains untouched.
ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model VARCHAR(120),
  ADD COLUMN IF NOT EXISTS artwork_width NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS artwork_height NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS front_artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS back_artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotation_items_front_artwork_id
  ON quotation_items(front_artwork_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_back_artwork_id
  ON quotation_items(back_artwork_id);
