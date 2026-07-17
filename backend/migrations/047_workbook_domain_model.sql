-- Workbook-aligned CRM/billing model (Decoinks-Database-Tables-Updated2).
-- This migration deliberately preserves every lead row.  Requested legacy
-- customer/invoice/order/PO data is removed without TRUNCATE ... CASCADE,
-- because that could cascade into leads through customers.

DO $$
BEGIN
  CREATE TEMP TABLE _lead_integrity_guard ON COMMIT DROP AS
  SELECT count(*)::bigint AS row_count,
         md5(string_agg(id::text || '|' || COALESCE(lead_number, '') || '|' ||
                        COALESCE(customer_name, ''), E'\n' ORDER BY id)) AS fingerprint
  FROM leads;
END $$;

-- Unlink records that are intentionally retained.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_customer_id UUID;
UPDATE leads SET source_customer_id = customer_id
WHERE customer_id IS NOT NULL AND source_customer_id IS NULL;
UPDATE leads SET customer_id = NULL WHERE customer_id IS NOT NULL;
UPDATE quotations SET customer_id = NULL WHERE customer_id IS NOT NULL;
UPDATE artworks SET order_id = NULL WHERE order_id IS NOT NULL;

-- Remove transactional dependencies first, then their parents.
DELETE FROM portal_status_updates;
DELETE FROM portal_order_visibility;
DELETE FROM portal_po_visibility;
DELETE FROM po_artworks;
DELETE FROM po_attachments;
DELETE FROM po_gangsheet_fragments;
DELETE FROM po_status_history;
DELETE FROM po_orders;
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;
DELETE FROM shipments;
DELETE FROM payments;
DELETE FROM invoice_items;
UPDATE orders SET invoice_id = NULL WHERE invoice_id IS NOT NULL;
UPDATE invoices SET order_id = NULL WHERE order_id IS NOT NULL;
DELETE FROM invoices;
DELETE FROM order_items_apparel;
DELETE FROM order_items_dtf;
DELETE FROM order_items_gangsheet;
DELETE FROM orders;
DELETE FROM party_addresses WHERE party_id IN (SELECT id FROM parties WHERE source_table = 'customers');
DELETE FROM party_contacts WHERE party_id IN (SELECT id FROM parties WHERE source_table = 'customers');
DELETE FROM party_roles WHERE party_id IN (SELECT id FROM parties WHERE source_table = 'customers');
DELETE FROM parties WHERE source_table = 'customers';
DELETE FROM customers;

-- customer / customer_address
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name VARCHAR(80);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name VARCHAR(80);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_phone_number VARCHAR(40);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(40);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(20) DEFAULT 'en';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_segment VARCHAR(40);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_email_active
  ON customers (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_type VARCHAR(12) NOT NULL CHECK (address_type IN ('billing','shipping')),
  line1 VARCHAR(160), line2 VARCHAR(160), city VARCHAR(80), state VARCHAR(60),
  zipcode VARCHAR(20), country VARCHAR(60), is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- lead additions. Existing contact columns remain populated and untouched.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_primary_id UUID;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram_id VARCHAR(80);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(80);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'medium';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_campaign VARCHAR(120);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS lead_qualifications (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  sizes_received BOOLEAN NOT NULL DEFAULT FALSE,
  artwork_received BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_date_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  shipping_address_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  budget_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method_pref VARCHAR(20),
  info_completeness_score SMALLINT NOT NULL DEFAULT 0 CHECK (info_completeness_score BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_no VARCHAR(30) NOT NULL UNIQUE,
  department VARCHAR(20) NOT NULL CHECK (department IN ('agent','production','fulfilment','design')),
  assign_to VARCHAR(40), assign_when TIMESTAMPTZ,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  task_type VARCHAR(40), title VARCHAR(200) NOT NULL, description TEXT,
  due_at TIMESTAMPTZ, remind_at TIMESTAMPTZ,
  priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled','overdue')),
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);

-- customer_artwork / artwork_version / agent_artwork
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS artwork_category VARCHAR(60);
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS artwork_micro_niche VARCHAR(80);
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS artwork_type VARCHAR(20);
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS storage_key VARCHAR(300);
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS file_name VARCHAR(200);
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

CREATE TABLE IF NOT EXISTS artwork_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artwork_id UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  version_type VARCHAR(20) NOT NULL CHECK (version_type IN ('raw','proof','final','production')),
  file_link VARCHAR(300) NOT NULL, file_type VARCHAR(10),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (artwork_id, version_no)
);

CREATE TABLE IF NOT EXISTS agent_artworks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_artwork_no VARCHAR(30) NOT NULL UNIQUE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL,
  design_type VARCHAR(20) NOT NULL CHECK (design_type IN ('mockup','artwork','gangsheet')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- quotation / quotation_line_item workbook fields
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS supersedes_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_type VARCHAR(12) DEFAULT 'percentage';
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tax_percentage NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS line_no SMALLINT;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS product_type VARCHAR(60);
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'pcs';
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS print_locations VARCHAR(120);

-- invoice / invoice_item / payment workbook fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS internal_no VARCHAR(30);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS original_shipping_charges NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_requirement_summary TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_notes TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_date DATE;

-- Compatibility sync: legacy API columns continue to work while workbook
-- names remain complete for reporting and all new integrations.
CREATE OR REPLACE FUNCTION sync_workbook_quotation_fields() RETURNS trigger AS $$
BEGIN
  NEW.discount_type := COALESCE(NEW.discount_type, 'percentage');
  NEW.discount_value := CASE WHEN NEW.discount_type = 'fixed'
    THEN COALESCE(NEW.discount_amt, 0) ELSE COALESCE(NEW.discount_pct, 0) END;
  NEW.tax_percentage := COALESCE(NEW.tax_pct, 0);
  NEW.shipping_amount := COALESCE(NEW.estimated_shipping, 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_workbook_quotation ON quotations;
CREATE TRIGGER trg_sync_workbook_quotation BEFORE INSERT OR UPDATE ON quotations
FOR EACH ROW EXECUTE FUNCTION sync_workbook_quotation_fields();

CREATE OR REPLACE FUNCTION sync_workbook_quotation_item_fields() RETURNS trigger AS $$
BEGIN
  NEW.line_no := COALESCE(NEW.line_no, NEW.sort_order + 1);
  NEW.product_type := COALESCE(NEW.product_type, NEW.description);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_workbook_quotation_item ON quotation_items;
CREATE TRIGGER trg_sync_workbook_quotation_item BEFORE INSERT OR UPDATE ON quotation_items
FOR EACH ROW EXECUTE FUNCTION sync_workbook_quotation_item_fields();

CREATE OR REPLACE FUNCTION sync_workbook_invoice_fields() RETURNS trigger AS $$
BEGIN
  NEW.original_shipping_charges := COALESCE(NEW.shipping_charges, 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_workbook_invoice ON invoices;
CREATE TRIGGER trg_sync_workbook_invoice BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION sync_workbook_invoice_fields();

CREATE OR REPLACE FUNCTION sync_workbook_payment_fields() RETURNS trigger AS $$
BEGIN
  NEW.payment_date := COALESCE(NEW.payment_date, NEW.paid_at::date, CURRENT_DATE);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_workbook_payment ON payments;
CREATE TRIGGER trg_sync_workbook_payment BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION sync_workbook_payment_fields();

-- Abort the whole migration if even one lead identity row changed.
DO $$
DECLARE before_count bigint; before_fp text; after_count bigint; after_fp text;
BEGIN
  SELECT row_count, fingerprint INTO before_count, before_fp FROM _lead_integrity_guard;
  SELECT count(*)::bigint,
         md5(string_agg(id::text || '|' || COALESCE(lead_number, '') || '|' ||
                        COALESCE(customer_name, ''), E'\n' ORDER BY id))
    INTO after_count, after_fp FROM leads;
  IF before_count IS DISTINCT FROM after_count OR before_fp IS DISTINCT FROM after_fp THEN
    RAISE EXCEPTION 'Lead preservation guard failed (%/% rows)', before_count, after_count;
  END IF;
END $$;
