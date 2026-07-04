-- ============================================================
--  039_baseline_repair.sql
--
--  Historically this project had TWO schema sources:
--    a) db/*.sql Docker init scripts (ran only on a fresh volume)
--    b) backend/migrations via run.js
--  ensure-baseline.js pre-seeds migrations 001–015 as "applied" on
--  Docker-init databases, but db/init.sql never created some of the
--  tables those migrations create (vendors, payments, pipeline_events).
--  Conversely, the portal tables were ONLY created by the init scripts,
--  never by a real migration — so a fresh migrations-only database
--  lacks them entirely.
--
--  This migration heals every known gap so that, from here on,
--  backend/migrations is the single source of truth for the schema.
--  Every statement is idempotent: on a database that already has the
--  object, it is a no-op.
-- ============================================================

-- ── 1. vendors (migration 009 is pre-seeded on Docker-init DBs) ──────────────
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
CREATE INDEX IF NOT EXISTS idx_vendors_active  ON vendors(is_active)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_deleted ON vendors(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_po_vendor_id
  ON purchase_orders(vendor_id) WHERE vendor_id IS NOT NULL;

-- ── 2. payments (migration 010 is pre-seeded; db/init.sql lacked it) ─────────
CREATE TABLE IF NOT EXISTS payments (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID          NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50)   NOT NULL,
  reference_no   VARCHAR(100),
  paid_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  recorded_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_method  ON payments(payment_method);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 3. pipeline_events (migration 011 is pre-seeded; db/init.sql lacked it) ──
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
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type   ON pipeline_events(event_type, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_target ON pipeline_events(target_table, target_id)
  WHERE target_table IS NOT NULL;
ALTER TABLE pipeline_events ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 4. Portal tables (previously created ONLY by db init scripts) ────────────
-- Rename guard first, mirroring 015, for databases where the portal tables
-- still carry their pre-rename names.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customer_portal_users')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='supplier_portal_users') THEN
    ALTER TABLE customer_portal_users RENAME TO supplier_portal_users;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='supplier_portal_users' AND column_name='customer_id') THEN
    ALTER TABLE supplier_portal_users RENAME COLUMN customer_id TO supplier_id;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS portal_status_updates (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID        NOT NULL REFERENCES orders(id)    ON DELETE CASCADE,
  supplier_id  UUID        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status       VARCHAR(50) NOT NULL,
  notes        TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_status_updates_order    ON portal_status_updates(order_id);
CREATE INDEX IF NOT EXISTS idx_portal_status_updates_supplier ON portal_status_updates(supplier_id);

-- ── 5. Columns from pre-seeded migrations, re-asserted idempotently ──────────
-- (004) leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS product_interest VARCHAR(200),
  ADD COLUMN IF NOT EXISTS artwork_url      TEXT;

-- (005/014) quotations
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS revision_number INTEGER    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_quote_id UUID REFERENCES quotations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_type      order_type;

-- (006) invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at  TIMESTAMPTZ;

-- (007/018) orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_id        UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS gangsheet_url     TEXT,
  ADD COLUMN IF NOT EXISTS artwork_locations JSONB,
  ADD COLUMN IF NOT EXISTS shipped_at        TIMESTAMPTZ;

-- (008/015) purchase_orders
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_id        UUID          REFERENCES suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_terms      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS currency           VARCHAR(3)    NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS exchange_rate      NUMERIC(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS buyer_id           UUID          REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS priority           VARCHAR(10)   NOT NULL DEFAULT 'Medium'
                                                CHECK (priority IN ('Low','Medium','High','Urgent')),
  ADD COLUMN IF NOT EXISTS shipping_method    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shipping_address   TEXT,
  ADD COLUMN IF NOT EXISTS billing_address    TEXT,
  ADD COLUMN IF NOT EXISTS terms_conditions   TEXT,
  ADD COLUMN IF NOT EXISTS approved_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason   TEXT,
  ADD COLUMN IF NOT EXISTS total_discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_charges    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_id           UUID          REFERENCES orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS language           VARCHAR(2)    NOT NULL DEFAULT 'en'
                                                CHECK (language IN ('en','zh')),
  ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;

-- (008/015) purchase_order_items — rename guards, then additive columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='description'
               AND data_type='character varying')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='purchase_order_items' AND column_name='item_name') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN description TO item_name;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='qty') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN qty TO qty_ordered;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='unit_cost') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN unit_cost TO unit_price;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='amount') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN amount TO line_total;
  END IF;
END $$;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS product_id       UUID          REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS hsn_code         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS uom              VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS discount_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amt     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_pct          NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amt          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_by_date DATE,
  ADD COLUMN IF NOT EXISTS remarks          TEXT,
  ADD COLUMN IF NOT EXISTS sort_order       INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- ── 6. Enum values that a pre-seeded path may have missed ────────────────────
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially Paid';
ALTER TYPE artwork_status ADD VALUE IF NOT EXISTS 'Draft';
ALTER TYPE artwork_status ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE artwork_status ADD VALUE IF NOT EXISTS 'Changes Requested';
ALTER TYPE artwork_status ADD VALUE IF NOT EXISTS 'Archived';

-- ── 7. updated_at triggers for EVERY table that has an updated_at column ─────
-- (the original trigger loop missed the new customers table, vendors,
--  settings, custom_fields, custom_field_values and supplier_portal_users)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables p
      ON p.tablename = c.table_name AND p.schemaname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name  = 'updated_at'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
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
