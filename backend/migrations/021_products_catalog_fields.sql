-- Add catalog-specific fields to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS model_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS color        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS size         VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_color ON products(color) WHERE deleted_at IS NULL;
