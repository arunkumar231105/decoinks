ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS catalog_style_id UUID REFERENCES blanktex.styles(style_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_color_id UUID REFERENCES blanktex.style_colors(style_color_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_size_id UUID REFERENCES blanktex.style_sizes(style_size_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_sku VARCHAR(100);

CREATE INDEX IF NOT EXISTS ix_quotation_items_catalog_style ON quotation_items(catalog_style_id);
CREATE INDEX IF NOT EXISTS ix_quotation_items_catalog_variant ON quotation_items(catalog_color_id,catalog_size_id);

COMMENT ON COLUMN quotation_items.catalog_style_id IS 'BlankTex Product Master style selected for this quotation line.';
COMMENT ON COLUMN quotation_items.catalog_sku IS 'Resolved BlankTex color/size SKU snapshot at quote time.';
