-- Customers table (end clients, separate from suppliers/vendors)
CREATE TABLE IF NOT EXISTS customers (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id        UUID         REFERENCES leads(id) ON DELETE SET NULL,
  customer_number VARCHAR(20) UNIQUE,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255),
  phone          VARCHAR(50),
  whatsapp       VARCHAR(50),
  company        VARCHAR(255),
  website        VARCHAR(255),
  facebook_id    VARCHAR(100),
  instagram_id   VARCHAR(100),
  address_line1  TEXT,
  city           VARCHAR(100),
  state          VARCHAR(100),
  zip            VARCHAR(20),
  country        VARCHAR(100) DEFAULT 'United States',
  billing_address TEXT,
  same_as_shipping BOOLEAN DEFAULT false,
  buyer_type     VARCHAR(50),
  internal_notes TEXT,
  status         VARCHAR(20)  DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Blocked')),
  created_by     UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customers_lead    ON customers(lead_id);
CREATE INDEX IF NOT EXISTS idx_customers_email   ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_status  ON customers(status);

-- Add customer_name to leads (the simple display name captured at lead entry)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Backfill customer_name from existing lead data
UPDATE leads SET customer_name = COALESCE(company_name, email, supplier_name, 'Unknown')
WHERE customer_name IS NULL;

-- Add customer_id to quotations
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Counter for customer numbers
INSERT INTO counters (prefix, entity, column_name, last_number)
VALUES ('CUST', 'customers', 'customer_number', 0)
ON CONFLICT (entity) DO NOTHING;
