-- Add social media / web fields to suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website     VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS instagram_id VARCHAR(100);

-- Global settings table
CREATE TABLE IF NOT EXISTS settings (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        VARCHAR(100) UNIQUE NOT NULL,
  value      TEXT,
  updated_by UUID        REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('company_name',           'Deco Inks'),
  ('company_logo_url',       NULL),
  ('invoice_show_discount',  'true'),
  ('invoice_show_packaging', 'true'),
  ('invoice_style',          'detailed'),
  ('quote_show_discount',    'true'),
  ('quote_require_approval', 'true')
ON CONFLICT (key) DO NOTHING;
