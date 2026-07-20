ALTER TABLE order_items_gangsheet
  ADD COLUMN IF NOT EXISTS artworks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN order_items_gangsheet.artworks IS
  'Gangsheet artwork rows: artwork_no, size, and uploaded image URL.';
