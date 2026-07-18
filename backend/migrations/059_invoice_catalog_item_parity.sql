-- Keep the exact BlankTex selection and commercial line snapshot on invoices.
-- Existing invoice rows remain valid; every new field is nullable/defaulted.
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS catalog_style_id UUID REFERENCES blanktex.styles(style_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_color_id UUID REFERENCES blanktex.style_colors(style_color_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_size_id UUID REFERENCES blanktex.style_sizes(style_size_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS catalog_sku VARCHAR(100),
  ADD COLUMN IF NOT EXISTS brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS product_image TEXT,
  ADD COLUMN IF NOT EXISTS style_description TEXT,
  ADD COLUMN IF NOT EXISTS artwork_no VARCHAR(100),
  ADD COLUMN IF NOT EXISTS line_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_code VARCHAR(40);

CREATE INDEX IF NOT EXISTS ix_invoice_items_catalog_style ON invoice_items(catalog_style_id);
CREATE INDEX IF NOT EXISTS ix_invoice_items_catalog_variant ON invoice_items(catalog_color_id,catalog_size_id);
