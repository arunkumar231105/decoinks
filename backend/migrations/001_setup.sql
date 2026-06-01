-- =============================================================================
--  Decoinks POS — full schema (idempotent)
--  Run via: npm run migrate   (migrations/run.js applies each file once)
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUMs (safe: exception handler skips duplicates) ─────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('Admin', 'Manager', 'Sales', 'Production', 'Viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE supplier_status AS ENUM ('Active', 'Inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_stage AS ENUM (
    'initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'New', 'Quotation', 'Pending', 'Payment Sent', 'Partial', 'Confirmed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM (
    'Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM (
    'Draft', 'Sent', 'Approved', 'Rejected', 'Expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_type AS ENUM ('apparel', 'gangsheet', 'dtf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'Draft', 'Confirmed', 'In Production', 'Ready to Ship',
    'Shipped', 'Delivered', 'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('Unpaid', 'Partial', 'Paid', 'Refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_terms AS ENUM (
    'Due on Receipt', 'Net 15', 'Net 30', 'Net 60'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM (
    'Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM (
    'Draft', 'Sent', 'Accepted', 'In Production', 'Shipped', 'Received',
    'Partial', 'Pending Approval', 'Approved', 'Partially Received', 'Closed', 'Cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_type AS ENUM (
    'Apparel', 'DTF', 'Gangsheet', 'Embroidery', 'Other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE artwork_status AS ENUM (
    'Pending Review', 'Approved', 'Revision Needed', 'Rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── updated_at trigger function ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        user_role    NOT NULL DEFAULT 'Sales',
  avatar_url  TEXT,
  phone       VARCHAR(30),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users(is_active);

-- ── suppliers (formerly customers) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(150)    NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(30),
  company       VARCHAR(150),
  address_line1 VARCHAR(200),
  address_line2 VARCHAR(200),
  city          VARCHAR(80),
  state         VARCHAR(80),
  zip           VARCHAR(20),
  country       VARCHAR(80)     DEFAULT 'United States',
  status        supplier_status NOT NULL DEFAULT 'Active',
  notes         TEXT,
  created_by    UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_suppliers_email     ON suppliers(email);
CREATE INDEX IF NOT EXISTS idx_suppliers_status    ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_deleted   ON suppliers(deleted_at) WHERE deleted_at IS NULL;

-- ── leads ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_number      VARCHAR(30) NOT NULL UNIQUE,
  supplier_id      UUID        REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name    VARCHAR(150),
  source           lead_source NOT NULL,
  description      TEXT,
  stage            lead_stage  NOT NULL DEFAULT 'initiated',
  status           lead_status NOT NULL DEFAULT 'New',
  stage_position   INTEGER     NOT NULL DEFAULT 0,
  assigned_to      UUID        REFERENCES users(id) ON DELETE SET NULL,
  has_artwork      BOOLEAN     NOT NULL DEFAULT FALSE,
  comment_count    INTEGER     NOT NULL DEFAULT 0,
  attachment_count INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leads_stage     ON leads(stage)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads(status)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_supplier  ON leads(supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assigned  ON leads(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_deleted   ON leads(deleted_at)  WHERE deleted_at IS NULL;
-- Deferred leads columns (added after init.sql base schema)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS product_interest VARCHAR(200);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS artwork_url      TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source) WHERE deleted_at IS NULL;

-- ── lead_comments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_comments_lead ON lead_comments(lead_id);

-- ── lead_attachments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_attachments (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  filename     VARCHAR(255) NOT NULL,
  storage_path TEXT         NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   INTEGER,
  uploaded_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead ON lead_attachments(lead_id);

-- ── quotations ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number VARCHAR(30)   NOT NULL UNIQUE,
  lead_id      UUID          REFERENCES leads(id) ON DELETE SET NULL,
  supplier_id  UUID          REFERENCES suppliers(id) ON DELETE SET NULL,
  status       quote_status  NOT NULL DEFAULT 'Draft',
  valid_until  DATE,
  subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5,2)           DEFAULT 0,
  discount_amt NUMERIC(12,2)          DEFAULT 0,
  tax_pct      NUMERIC(5,2)           DEFAULT 0,
  tax_amt      NUMERIC(12,2)          DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  order_type   order_type,
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotations_status   ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_supplier ON quotations(supplier_id);

-- Deferred columns: added after initial creation (idempotent — handles init.sql base schema)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS order_type         order_type;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS currency           VARCHAR(3)   NOT NULL DEFAULT 'USD';
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS revision_number    INTEGER      NOT NULL DEFAULT 1;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS parent_quote_id    UUID REFERENCES quotations(id) ON DELETE RESTRICT;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_quotations_lead_id ON quotations(lead_id);
CREATE INDEX IF NOT EXISTS idx_quotations_parent  ON quotations(parent_quote_id) WHERE parent_quote_id IS NOT NULL;

-- ── quotation_items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_items (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID          NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description  VARCHAR(255)  NOT NULL,
  qty          INTEGER       NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order   INTEGER                DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);

-- ── orders ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number     VARCHAR(30)    NOT NULL UNIQUE,
  quotation_id     UUID           REFERENCES quotations(id) ON DELETE SET NULL,
  supplier_id      UUID           REFERENCES suppliers(id) ON DELETE SET NULL,
  order_type       order_type     NOT NULL,
  status           order_status   NOT NULL DEFAULT 'Draft',
  payment_status   payment_status NOT NULL DEFAULT 'Unpaid',
  payment_method   payment_method,
  payment_terms    payment_terms           DEFAULT 'Due on Receipt',
  currency         VARCHAR(3)              DEFAULT 'USD',
  order_date       DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  rush_services    NUMERIC(12,2)           DEFAULT 0,
  shipping_charges NUMERIC(12,2)           DEFAULT 0,
  subtotal         NUMERIC(12,2)  NOT NULL DEFAULT 0,
  discount_pct     NUMERIC(5,2)            DEFAULT 0,
  discount_amt     NUMERIC(12,2)           DEFAULT 0,
  tax_pct          NUMERIC(5,2)            DEFAULT 7,
  tax_amt          NUMERIC(12,2)           DEFAULT 0,
  total            NUMERIC(12,2)  NOT NULL DEFAULT 0,
  notes            TEXT,
  shipping_name    VARCHAR(150),
  shipping_address TEXT,
  contact_name     VARCHAR(150),
  contact_email    VARCHAR(255),
  contact_phone    VARCHAR(30),
  gangsheet_url     TEXT,
  artwork_locations JSONB,
  shipped_at        TIMESTAMPTZ,
  assigned_to       UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_by        UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_supplier  ON orders(supplier_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_type      ON orders(order_type)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_date      ON orders(order_date)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_deleted   ON orders(deleted_at)    WHERE deleted_at IS NULL;

-- ── order_items_apparel ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items_apparel (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item         VARCHAR(100)  NOT NULL,
  color        VARCHAR(50),
  size         VARCHAR(20),
  qty          INTEGER       NOT NULL DEFAULT 1,
  artwork_no   VARCHAR(50),
  artwork_size VARCHAR(50),
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  front_image  TEXT,
  back_image   TEXT,
  sort_order   INTEGER                DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oia_order ON order_items_apparel(order_id);

-- ── order_items_gangsheet ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items_gangsheet (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  size            VARCHAR(50)   NOT NULL,
  no_artworks     INTEGER       NOT NULL DEFAULT 1,
  qty             INTEGER       NOT NULL DEFAULT 1,
  price_per_sheet NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  front_image     TEXT,
  sort_order      INTEGER                DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oig_order ON order_items_gangsheet(order_id);

-- ── order_items_dtf ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items_dtf (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artwork_name  VARCHAR(150)  NOT NULL,
  size          VARCHAR(50),
  qty           INTEGER       NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  artwork_image TEXT,
  sort_order    INTEGER                DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_oid_order ON order_items_dtf(order_id);

-- ── invoices ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(30)    NOT NULL UNIQUE,
  order_id       UUID           REFERENCES orders(id) ON DELETE SET NULL,
  supplier_id    UUID           REFERENCES suppliers(id) ON DELETE SET NULL,
  status         invoice_status NOT NULL DEFAULT 'Draft',
  issue_date     DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  subtotal       NUMERIC(12,2)  NOT NULL DEFAULT 0,
  discount_amt   NUMERIC(12,2)           DEFAULT 0,
  tax_amt        NUMERIC(12,2)           DEFAULT 0,
  total          NUMERIC(12,2)  NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(12,2)           DEFAULT 0,
  balance_due    NUMERIC(12,2)           DEFAULT 0,
  notes          TEXT,
  quote_id       UUID           REFERENCES quotations(id) ON DELETE SET NULL,
  sent_at        TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_by     UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order    ON invoices(order_id);
-- Deferred invoice columns (added after init.sql base schema)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_id  UUID REFERENCES quotations(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at   TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at   TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_invoices_quote_id ON invoices(quote_id) WHERE quote_id IS NOT NULL;

-- Back-reference: orders.invoice_id (deferred to avoid circular FK at table creation)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT;
-- Deferred orders columns (added after init.sql base schema)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gangsheet_url     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS artwork_locations JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at        TIMESTAMPTZ;

-- ── purchase_orders ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number          VARCHAR(30)   NOT NULL UNIQUE,
  supplier_id        UUID          REFERENCES suppliers(id) ON DELETE RESTRICT,
  vendor_name        VARCHAR(150),
  supplier_reference VARCHAR(100),
  payment_terms      VARCHAR(50),
  currency           VARCHAR(3)    NOT NULL DEFAULT 'USD',
  exchange_rate      NUMERIC(10,4) NOT NULL DEFAULT 1,
  buyer_id           UUID          REFERENCES users(id) ON DELETE SET NULL,
  department         VARCHAR(100),
  priority           VARCHAR(10)   NOT NULL DEFAULT 'Medium'
                                   CHECK (priority IN ('Low','Medium','High','Urgent')),
  status             po_status     NOT NULL DEFAULT 'Draft',
  order_date         DATE          DEFAULT CURRENT_DATE,
  expected_date      DATE,
  shipping_method    VARCHAR(50),
  shipping_address   TEXT,
  billing_address    TEXT,
  terms_conditions   TEXT,
  approved_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  cancelled_reason   TEXT,
  subtotal           NUMERIC(12,2) DEFAULT 0,
  total_discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tax          NUMERIC(12,2) NOT NULL DEFAULT 0,
  freight_charges    NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_charges      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) DEFAULT 0,
  grand_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes              TEXT,
  language           VARCHAR(2)    NOT NULL DEFAULT 'en' CHECK (language IN ('en','zh')),
  sent_at            TIMESTAMPTZ,
  order_id           UUID          REFERENCES orders(id) ON DELETE RESTRICT,
  deleted_at         TIMESTAMPTZ,
  created_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'en'
    CHECK (language IN ('en','zh'));
CREATE INDEX IF NOT EXISTS idx_po_status     ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier   ON purchase_orders(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_order_id   ON purchase_orders(order_id)    WHERE order_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_language   ON purchase_orders(language);

-- ── purchase_order_items ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id            UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name        VARCHAR(255)  NOT NULL,
  description      TEXT,
  hsn_code         VARCHAR(20),
  uom              VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  qty_ordered      INTEGER       NOT NULL DEFAULT 1,
  unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_amt     NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_pct          NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_amt          NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  required_by_date DATE,
  remarks          TEXT,
  sort_order       INTEGER       NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);

-- ── shipments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipments (
  id                 UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_number    VARCHAR(30)     NOT NULL UNIQUE,
  order_id           UUID            REFERENCES orders(id) ON DELETE SET NULL,
  supplier_id        UUID            REFERENCES suppliers(id) ON DELETE SET NULL,
  status             shipment_status NOT NULL DEFAULT 'Pending',
  carrier            VARCHAR(80),
  tracking_number    VARCHAR(100),
  ship_date          DATE,
  estimated_delivery DATE,
  weight_lbs         NUMERIC(8,2),
  shipping_cost      NUMERIC(12,2),
  recipient_name     VARCHAR(150),
  address            TEXT,
  notes              TEXT,
  created_by         UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_status   ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_order    ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_supplier ON shipments(supplier_id);

-- ── products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku          VARCHAR(50)   NOT NULL UNIQUE,
  name         VARCHAR(200)  NOT NULL,
  product_type product_type  NOT NULL,
  description  TEXT,
  base_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price   NUMERIC(12,2)          DEFAULT 0,
  stock_qty    INTEGER                DEFAULT 0,
  image_url    TEXT,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_products_sku     ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_type    ON products(product_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_active  ON products(is_active)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at)   WHERE deleted_at IS NULL;

-- Deferred FK: purchase_order_items.product_id (products defined above)
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

-- ── artworks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artworks (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  artwork_no    VARCHAR(50)    NOT NULL UNIQUE,
  name          VARCHAR(200)   NOT NULL,
  supplier_id   UUID           REFERENCES suppliers(id) ON DELETE SET NULL,
  order_id      UUID           REFERENCES orders(id) ON DELETE SET NULL,
  status        artwork_status NOT NULL DEFAULT 'Pending Review',
  file_url      TEXT,
  thumbnail_url TEXT,
  file_type     VARCHAR(20),
  tags          TEXT[],
  notes         TEXT,
  uploaded_by   UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_artworks_status   ON artworks(status);
CREATE INDEX IF NOT EXISTS idx_artworks_supplier ON artworks(supplier_id);
CREATE INDEX IF NOT EXISTS idx_artworks_order    ON artworks(order_id);

-- ── activity_logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID        NOT NULL,
  action      VARCHAR(80) NOT NULL,
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_entity  ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_user    ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);

-- ── payments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount         NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(50)  NOT NULL,
  reference_no   VARCHAR(100),
  notes          TEXT,
  recorded_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  paid_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_method  ON payments(payment_method);

-- ── pipeline_events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_events (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type   VARCHAR(80) NOT NULL,
  source_table VARCHAR(50) NOT NULL,
  source_id    UUID        NOT NULL,
  target_table VARCHAR(50),
  target_id    UUID,
  triggered_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB
);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_source ON pipeline_events(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type   ON pipeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_target ON pipeline_events(target_table, target_id)
  WHERE target_table IS NOT NULL;
-- Add triggered_at to any existing pipeline_events table that was created with created_at
ALTER TABLE pipeline_events ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── refresh_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rt_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash     ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_expires  ON refresh_tokens(expires_at);

-- ── po_attachments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_attachments (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  filename    VARCHAR(255) NOT NULL,
  file_url    TEXT         NOT NULL,
  file_size   INTEGER,
  mime_type   VARCHAR(100),
  uploaded_by UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_attachments_po ON po_attachments(po_id);

-- ── po_status_history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_status_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status   VARCHAR(50) NOT NULL,
  changed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_status_history_po ON po_status_history(po_id);

-- ── supplier_portal_users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_portal_users (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id    UUID         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  username       VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login     TIMESTAMPTZ,
  must_change_pw BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by     UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_users_supplier ON supplier_portal_users(supplier_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_username ON supplier_portal_users(username);

-- ── portal_order_visibility ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_order_visibility (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id UUID        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sent_by     UUID        REFERENCES users(id),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_visible  BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE(order_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_vis_supplier ON portal_order_visibility(supplier_id);
CREATE INDEX IF NOT EXISTS idx_portal_vis_order    ON portal_order_visibility(order_id);

-- ── portal_po_visibility ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_po_visibility (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id UUID        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sent_by     UUID        REFERENCES users(id),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_visible  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(po_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_po_vis_supplier ON portal_po_visibility(supplier_id);
ALTER TABLE portal_po_visibility ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── portal_notifications ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_notifications (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id  UUID         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  type         VARCHAR(50)  NOT NULL,
  title        VARCHAR(255) NOT NULL,
  message      TEXT,
  reference_id UUID,
  is_read      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_notif_supplier ON portal_notifications(supplier_id, is_read);

-- ── updated_at triggers (idempotent) ─────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'suppliers', 'leads', 'quotations', 'orders',
    'invoices', 'purchase_orders', 'shipments', 'products', 'artworks'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t)
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
       )
    THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        t, t
      );
    END IF;
  END LOOP;
END $$;
