-- Preserve product/artwork identity throughout Invoice -> Sales Order -> PO.
ALTER TABLE order_items_apparel
  ADD COLUMN IF NOT EXISTS catalog_style_id UUID REFERENCES blanktex.styles(style_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_color_id UUID REFERENCES blanktex.style_colors(style_color_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_size_id UUID REFERENCES blanktex.style_sizes(style_size_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_sku VARCHAR(100),
  ADD COLUMN IF NOT EXISTS brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS product_image TEXT,
  ADD COLUMN IF NOT EXISTS style_description TEXT;

ALTER TABLE order_items_dtf
  ADD COLUMN IF NOT EXISTS artwork_no VARCHAR(100);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS catalog_style_id UUID REFERENCES blanktex.styles(style_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_color_id UUID REFERENCES blanktex.style_colors(style_color_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_size_id UUID REFERENCES blanktex.style_sizes(style_size_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_sku VARCHAR(100),
  ADD COLUMN IF NOT EXISTS product_image TEXT,
  ADD COLUMN IF NOT EXISTS style_description TEXT,
  ADD COLUMN IF NOT EXISTS artwork_no VARCHAR(100);

CREATE INDEX IF NOT EXISTS ix_order_apparel_catalog_style ON order_items_apparel(catalog_style_id);
CREATE INDEX IF NOT EXISTS ix_po_items_catalog_style ON purchase_order_items(catalog_style_id);
