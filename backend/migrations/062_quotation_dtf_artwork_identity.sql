-- Preserve DTF artwork identity through quotation, invoice and sales order.
ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS artwork_no VARCHAR(100);

CREATE INDEX IF NOT EXISTS ix_quotation_items_artwork_no
  ON quotation_items(artwork_no);
