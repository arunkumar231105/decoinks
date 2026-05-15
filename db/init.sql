-- ============================================================
--  decoinks_db  –  Full Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
--  3.1  users
-- ─────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('Admin', 'Manager', 'Sales', 'Production', 'Viewer');

CREATE TABLE users (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(120) NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  role         user_role    NOT NULL DEFAULT 'Sales',
  avatar_url   TEXT,
  phone        VARCHAR(30),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ─────────────────────────────────────────
--  3.2  customers
-- ─────────────────────────────────────────
CREATE TYPE customer_status AS ENUM ('Active', 'Inactive');

CREATE TABLE customers (
  id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(150)    NOT NULL,
  email         VARCHAR(255)    UNIQUE,
  phone         VARCHAR(30),
  company       VARCHAR(150),
  address_line1 VARCHAR(200),
  address_line2 VARCHAR(200),
  city          VARCHAR(80),
  state         VARCHAR(80),
  zip           VARCHAR(20),
  country       VARCHAR(80)     DEFAULT 'United States',
  status        customer_status NOT NULL DEFAULT 'Active',
  notes         TEXT,
  created_by    UUID            REFERENCES users(id),
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_customers_email  ON customers(email);
CREATE INDEX idx_customers_status ON customers(status);

-- ─────────────────────────────────────────
--  3.3  leads
-- ─────────────────────────────────────────
CREATE TYPE lead_stage AS ENUM (
  'initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed'
);
CREATE TYPE lead_status AS ENUM (
  'New', 'Quotation', 'Pending', 'Payment Sent', 'Partial', 'Confirmed'
);
CREATE TYPE lead_source AS ENUM (
  'Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone'
);

CREATE TABLE leads (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_number      VARCHAR(30) NOT NULL UNIQUE,
  customer_id      UUID        REFERENCES customers(id),
  customer_name    VARCHAR(150),
  source           lead_source NOT NULL,
  description      TEXT,
  stage            lead_stage  NOT NULL DEFAULT 'initiated',
  status           lead_status NOT NULL DEFAULT 'New',
  stage_position   INTEGER     NOT NULL DEFAULT 0,
  assigned_to      UUID        REFERENCES users(id),
  has_artwork      BOOLEAN     DEFAULT FALSE,
  comment_count    INTEGER     DEFAULT 0,
  attachment_count INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_leads_stage    ON leads(stage);
CREATE INDEX idx_leads_customer ON leads(customer_id);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);

-- ─────────────────────────────────────────
--  3.4  lead_comments & lead_attachments
-- ─────────────────────────────────────────
CREATE TABLE lead_comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID        REFERENCES users(id),
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lead_attachments (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  filename     VARCHAR(255) NOT NULL,
  storage_path TEXT         NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   INTEGER,
  uploaded_by  UUID         REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
--  3.5  quotations
-- ─────────────────────────────────────────
CREATE TYPE quote_status AS ENUM (
  'Draft', 'Sent', 'Approved', 'Rejected', 'Expired'
);

CREATE TABLE quotations (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number VARCHAR(30)   NOT NULL UNIQUE,
  lead_id      UUID          REFERENCES leads(id),
  customer_id  UUID          REFERENCES customers(id),
  status       quote_status  NOT NULL DEFAULT 'Draft',
  valid_until  DATE,
  subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5,2)  DEFAULT 0,
  discount_amt NUMERIC(12,2) DEFAULT 0,
  tax_pct      NUMERIC(5,2)  DEFAULT 0,
  tax_amt      NUMERIC(12,2) DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  created_by   UUID          REFERENCES users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE quotation_items (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID          NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description  VARCHAR(255)  NOT NULL,
  qty          INTEGER       NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order   INTEGER       DEFAULT 0
);

-- ─────────────────────────────────────────
--  3.6  orders
-- ─────────────────────────────────────────
CREATE TYPE order_type     AS ENUM ('apparel', 'gangsheet', 'dtf');
CREATE TYPE order_status   AS ENUM (
  'Draft', 'Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled'
);
CREATE TYPE payment_status AS ENUM ('Unpaid', 'Partial', 'Paid', 'Refunded');
CREATE TYPE payment_method AS ENUM ('cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other');
CREATE TYPE payment_terms  AS ENUM ('Due on Receipt', 'Net 15', 'Net 30', 'Net 60');

CREATE TABLE orders (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number     VARCHAR(30)    NOT NULL UNIQUE,
  quotation_id     UUID           REFERENCES quotations(id),
  customer_id      UUID           REFERENCES customers(id),
  order_type       order_type     NOT NULL,
  status           order_status   NOT NULL DEFAULT 'Draft',
  payment_status   payment_status NOT NULL DEFAULT 'Unpaid',
  payment_method   payment_method,
  payment_terms    payment_terms  DEFAULT 'Due on Receipt',
  currency         VARCHAR(3)     DEFAULT 'USD',
  order_date       DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  rush_services    NUMERIC(12,2)  DEFAULT 0,
  shipping_charges NUMERIC(12,2)  DEFAULT 0,
  subtotal         NUMERIC(12,2)  NOT NULL DEFAULT 0,
  discount_pct     NUMERIC(5,2)   DEFAULT 0,
  discount_amt     NUMERIC(12,2)  DEFAULT 0,
  tax_pct          NUMERIC(5,2)   DEFAULT 7,
  tax_amt          NUMERIC(12,2)  DEFAULT 0,
  total            NUMERIC(12,2)  NOT NULL DEFAULT 0,
  notes            TEXT,
  shipping_name    VARCHAR(150),
  shipping_address TEXT,
  contact_name     VARCHAR(150),
  contact_email    VARCHAR(255),
  contact_phone    VARCHAR(30),
  assigned_to      UUID           REFERENCES users(id),
  created_by       UUID           REFERENCES users(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_orders_date     ON orders(order_date);

-- ─────────────────────────────────────────
--  3.7  order_items (3 types)
-- ─────────────────────────────────────────
CREATE TABLE order_items_apparel (
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
  sort_order   INTEGER       DEFAULT 0
);

CREATE TABLE order_items_gangsheet (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  size            VARCHAR(50)   NOT NULL,
  no_artworks     INTEGER       NOT NULL DEFAULT 1,
  qty             INTEGER       NOT NULL DEFAULT 1,
  price_per_sheet NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  front_image     TEXT,
  sort_order      INTEGER       DEFAULT 0
);

CREATE TABLE order_items_dtf (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artwork_name  VARCHAR(150)  NOT NULL,
  size          VARCHAR(50),
  qty           INTEGER       NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  artwork_image TEXT,
  sort_order    INTEGER       DEFAULT 0
);

-- ─────────────────────────────────────────
--  3.8  invoices
-- ─────────────────────────────────────────
CREATE TYPE invoice_status AS ENUM ('Draft', 'Sent', 'Paid', 'Overdue', 'Void');

CREATE TABLE invoices (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(30)    NOT NULL UNIQUE,
  order_id       UUID           REFERENCES orders(id),
  customer_id    UUID           REFERENCES customers(id),
  status         invoice_status NOT NULL DEFAULT 'Draft',
  issue_date     DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  subtotal       NUMERIC(12,2)  NOT NULL DEFAULT 0,
  discount_amt   NUMERIC(12,2)  DEFAULT 0,
  tax_amt        NUMERIC(12,2)  DEFAULT 0,
  total          NUMERIC(12,2)  NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(12,2)  DEFAULT 0,
  balance_due    NUMERIC(12,2)  DEFAULT 0,
  notes          TEXT,
  created_by     UUID           REFERENCES users(id),
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
--  3.9  purchase_orders
-- ─────────────────────────────────────────
CREATE TYPE po_status AS ENUM ('Draft', 'Sent', 'Received', 'Partial', 'Cancelled');

CREATE TABLE purchase_orders (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number     VARCHAR(30)   NOT NULL UNIQUE,
  vendor_name   VARCHAR(150),
  status        po_status     NOT NULL DEFAULT 'Draft',
  order_date    DATE          DEFAULT CURRENT_DATE,
  expected_date DATE,
  subtotal      NUMERIC(12,2) DEFAULT 0,
  total         NUMERIC(12,2) DEFAULT 0,
  notes         TEXT,
  created_by    UUID          REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_order_items (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description VARCHAR(255)  NOT NULL,
  qty         INTEGER       NOT NULL DEFAULT 1,
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────
--  3.10 shipments
-- ─────────────────────────────────────────
CREATE TYPE shipment_status AS ENUM (
  'Pending', 'Label Created', 'Picked Up', 'In Transit', 'Delivered', 'Exception'
);

CREATE TABLE shipments (
  id                 UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_number    VARCHAR(30)     NOT NULL UNIQUE,
  order_id           UUID            REFERENCES orders(id),
  customer_id        UUID            REFERENCES customers(id),
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
  created_by         UUID            REFERENCES users(id),
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
--  3.11 products
-- ─────────────────────────────────────────
CREATE TYPE product_type AS ENUM ('Apparel', 'DTF', 'Gangsheet', 'Embroidery', 'Other');

CREATE TABLE products (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku          VARCHAR(50)   NOT NULL UNIQUE,
  name         VARCHAR(200)  NOT NULL,
  product_type product_type  NOT NULL,
  description  TEXT,
  base_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price   NUMERIC(12,2) DEFAULT 0,
  stock_qty    INTEGER       DEFAULT 0,
  image_url    TEXT,
  is_active    BOOLEAN       DEFAULT TRUE,
  created_by   UUID          REFERENCES users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────
--  3.12 artworks
-- ─────────────────────────────────────────
CREATE TYPE artwork_status AS ENUM (
  'Pending Review', 'Approved', 'Revision Needed', 'Rejected'
);

CREATE TABLE artworks (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  artwork_no    VARCHAR(50)    NOT NULL UNIQUE,
  name          VARCHAR(200)   NOT NULL,
  customer_id   UUID           REFERENCES customers(id),
  order_id      UUID           REFERENCES orders(id),
  status        artwork_status NOT NULL DEFAULT 'Pending Review',
  file_url      TEXT           NOT NULL,
  thumbnail_url TEXT,
  file_type     VARCHAR(20),
  tags          TEXT[],
  notes         TEXT,
  uploaded_by   UUID           REFERENCES users(id),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
--  3.13 activity_logs
-- ─────────────────────────────────────────
CREATE TABLE activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID        NOT NULL,
  action      VARCHAR(80) NOT NULL,
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_entity  ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_user    ON activity_logs(user_id);
CREATE INDEX idx_activity_created ON activity_logs(created_at DESC);
