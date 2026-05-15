-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Users ─────────────────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Customers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
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
  status        customer_status NOT NULL DEFAULT 'Active',
  notes         TEXT,
  created_by    UUID            REFERENCES users(id),
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customers_email  ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

-- ── Leads ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
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
CREATE INDEX IF NOT EXISTS idx_leads_stage    ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);

-- ── Lead Comments & Attachments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID        REFERENCES users(id),
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_attachments (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  filename     VARCHAR(255) NOT NULL,
  storage_path TEXT         NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   INTEGER,
  uploaded_by  UUID         REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Quotations ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number  VARCHAR(30)  NOT NULL UNIQUE,
  lead_id       UUID         REFERENCES leads(id),
  customer_id   UUID         REFERENCES customers(id),
  status        quote_status NOT NULL DEFAULT 'Draft',
  valid_until   DATE,
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_pct  NUMERIC(5,2)  DEFAULT 0,
  discount_amt  NUMERIC(12,2) DEFAULT 0,
  tax_pct       NUMERIC(5,2)  DEFAULT 0,
  tax_amt       NUMERIC(12,2) DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    UUID          REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID          NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description  VARCHAR(255)  NOT NULL,
  qty          INTEGER       NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order   INTEGER       DEFAULT 0
);

-- ── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
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
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date     ON orders(order_date);

-- ── Order Items ───────────────────────────────────────────────────────────────
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
  sort_order   INTEGER       DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items_gangsheet (
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

CREATE TABLE IF NOT EXISTS order_items_dtf (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artwork_name VARCHAR(150)  NOT NULL,
  size         VARCHAR(50),
  qty          INTEGER       NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  artwork_image TEXT,
  sort_order   INTEGER       DEFAULT 0
);

-- ── Invoices ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
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

-- ── Purchase Orders ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number     VARCHAR(30) NOT NULL UNIQUE,
  vendor_name   VARCHAR(150),
  status        po_status NOT NULL DEFAULT 'Draft',
  order_date    DATE      DEFAULT CURRENT_DATE,
  expected_date DATE,
  subtotal      NUMERIC(12,2) DEFAULT 0,
  total         NUMERIC(12,2) DEFAULT 0,
  notes         TEXT,
  created_by    UUID      REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description VARCHAR(255)  NOT NULL,
  qty         INTEGER       NOT NULL DEFAULT 1,
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- ── Shipments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipments (
  id               UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_number  VARCHAR(30)      NOT NULL UNIQUE,
  order_id         UUID             REFERENCES orders(id),
  customer_id      UUID             REFERENCES customers(id),
  status           shipment_status  NOT NULL DEFAULT 'Pending',
  carrier          VARCHAR(80),
  tracking_number  VARCHAR(100),
  ship_date        DATE,
  estimated_delivery DATE,
  weight_lbs       NUMERIC(8,2),
  shipping_cost    NUMERIC(12,2),
  recipient_name   VARCHAR(150),
  address          TEXT,
  notes            TEXT,
  created_by       UUID             REFERENCES users(id),
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku          VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(200) NOT NULL,
  product_type product_type NOT NULL,
  description  TEXT,
  base_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price   NUMERIC(12,2) DEFAULT 0,
  stock_qty    INTEGER      DEFAULT 0,
  image_url    TEXT,
  is_active    BOOLEAN      DEFAULT TRUE,
  created_by   UUID         REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

-- ── Artworks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artworks (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  artwork_no    VARCHAR(50)    NOT NULL UNIQUE,
  name          VARCHAR(200)   NOT NULL,
  customer_id   UUID           REFERENCES customers(id),
  order_id      UUID           REFERENCES orders(id),
  status        artwork_status NOT NULL DEFAULT 'Pending Review',
  file_url      TEXT,
  thumbnail_url TEXT,
  file_type     VARCHAR(20),
  tags          TEXT[],
  notes         TEXT,
  uploaded_by   UUID           REFERENCES users(id),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── Activity Logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id),
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

-- ── updated_at triggers ───────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'customers', 'leads', 'quotations', 'orders',
    'invoices', 'purchase_orders', 'shipments', 'products', 'artworks'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || t || '_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        t, t
      );
    END IF;
  END LOOP;
END $$;
