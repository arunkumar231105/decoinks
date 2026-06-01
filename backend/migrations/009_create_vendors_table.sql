-- ============================================================
--  009_create_vendors_table.sql
--  Creates the vendors (print suppliers) table and links
--  purchase_orders.vendor_id FK to it.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendors (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               VARCHAR(200) NOT NULL,
  name_zh            VARCHAR(200),
  contact_person     VARCHAR(150),
  email              VARCHAR(255),
  phone              VARCHAR(30),
  preferred_language VARCHAR(2)   NOT NULL DEFAULT 'en'
                       CHECK (preferred_language IN ('en','zh')),
  address            TEXT,
  currency           VARCHAR(3)   NOT NULL DEFAULT 'USD',
  payment_terms      VARCHAR(50),
  notes              TEXT,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vendors_active  ON vendors(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_deleted ON vendors(deleted_at) WHERE deleted_at IS NULL;

-- Link purchase_orders to the new vendors table
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_po_vendor_id
  ON purchase_orders(vendor_id) WHERE vendor_id IS NOT NULL;
