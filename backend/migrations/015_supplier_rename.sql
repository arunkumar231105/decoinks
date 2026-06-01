-- ============================================================
--  015_supplier_rename.sql
--  Idempotent version of the customers→suppliers rename.
--  Safe to run on a DB that was either:
--    a) already renamed via the Docker entrypoint init script, or
--    b) never renamed (volume existed before the entrypoint was updated)
-- ============================================================

-- ── ENUM additions (outside transaction — Postgres DDL limitation) ────────────
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Partially Received';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Closed';

-- ── Main rename (skips silently if already done) ──────────────────────────────
DO $migrate$
BEGIN

  -- ── 1. Rename customers table & type (only if customers still exists) ──────
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customers') THEN
    -- Rename the enum type (only if it's still called customer_status)
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname='customer_status') THEN
      ALTER TYPE customer_status RENAME TO supplier_status;
    END IF;

    ALTER TABLE customers RENAME TO suppliers;

    -- Rename indexes if they still have the old names
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_customers_email')  THEN
      ALTER INDEX idx_customers_email  RENAME TO idx_suppliers_email;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_customers_status') THEN
      ALTER INDEX idx_customers_status RENAME TO idx_suppliers_status;
    END IF;
  END IF;

  -- ── 2. Rename FK columns in dependent tables (only if still old names) ─────

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='leads' AND column_name='customer_id') THEN
    ALTER TABLE leads RENAME COLUMN customer_id   TO supplier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='leads' AND column_name='customer_name') THEN
    ALTER TABLE leads RENAME COLUMN customer_name TO supplier_name;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_leads_customer') THEN
    ALTER INDEX idx_leads_customer RENAME TO idx_leads_supplier;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='quotations' AND column_name='customer_id') THEN
    ALTER TABLE quotations RENAME COLUMN customer_id TO supplier_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='orders' AND column_name='customer_id') THEN
    ALTER TABLE orders RENAME COLUMN customer_id TO supplier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_orders_customer') THEN
    ALTER INDEX idx_orders_customer RENAME TO idx_orders_supplier;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='invoices' AND column_name='customer_id') THEN
    ALTER TABLE invoices RENAME COLUMN customer_id TO supplier_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='shipments' AND column_name='customer_id') THEN
    ALTER TABLE shipments RENAME COLUMN customer_id TO supplier_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='artworks' AND column_name='customer_id') THEN
    ALTER TABLE artworks RENAME COLUMN customer_id TO supplier_id;
  END IF;

  -- ── 3. Rename portal tables ────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='customer_portal_users') THEN
    ALTER TABLE customer_portal_users RENAME TO supplier_portal_users;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='supplier_portal_users' AND column_name='customer_id') THEN
    ALTER TABLE supplier_portal_users RENAME COLUMN customer_id TO supplier_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_portal_users_customer') THEN
    ALTER INDEX idx_portal_users_customer RENAME TO idx_portal_users_supplier;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_portal_users_username') THEN
    ALTER INDEX idx_portal_users_username RENAME TO idx_supplier_portal_users_username;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='portal_order_visibility' AND column_name='customer_id') THEN
    ALTER TABLE portal_order_visibility RENAME COLUMN customer_id TO supplier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_portal_vis_customer') THEN
    ALTER INDEX idx_portal_vis_customer RENAME TO idx_portal_vis_supplier;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='portal_po_visibility' AND column_name='customer_id') THEN
    ALTER TABLE portal_po_visibility RENAME COLUMN customer_id TO supplier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_portal_po_vis_customer') THEN
    ALTER INDEX idx_portal_po_vis_customer RENAME TO idx_portal_po_vis_supplier;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='portal_notifications' AND column_name='customer_id') THEN
    ALTER TABLE portal_notifications RENAME COLUMN customer_id TO supplier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_portal_notif_customer') THEN
    ALTER INDEX idx_portal_notif_customer RENAME TO idx_portal_notif_supplier;
  END IF;

  -- ── 4. Data migration: activity_logs entity_type ──────────────────────────
  UPDATE activity_logs SET entity_type = 'supplier' WHERE entity_type = 'customer';

  -- ── 5. Enhance purchase_orders (idempotent via IF NOT EXISTS) ─────────────
  ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS supplier_id        UUID          REFERENCES suppliers(id),
    ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(100),
    ADD COLUMN IF NOT EXISTS payment_terms      VARCHAR(50),
    ADD COLUMN IF NOT EXISTS currency           VARCHAR(3)    NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS exchange_rate      NUMERIC(10,4) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS buyer_id           UUID          REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS department         VARCHAR(100),
    ADD COLUMN IF NOT EXISTS priority           VARCHAR(10)   NOT NULL DEFAULT 'Medium'
                                                  CHECK (priority IN ('Low','Medium','High','Urgent')),
    ADD COLUMN IF NOT EXISTS shipping_method    VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_address   TEXT,
    ADD COLUMN IF NOT EXISTS billing_address    TEXT,
    ADD COLUMN IF NOT EXISTS terms_conditions   TEXT,
    ADD COLUMN IF NOT EXISTS approved_by        UUID          REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_reason   TEXT,
    ADD COLUMN IF NOT EXISTS total_discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tax          NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS freight_charges    NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS other_charges      NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS grand_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS order_id           UUID          REFERENCES orders(id);

  UPDATE purchase_orders SET grand_total = total WHERE grand_total = 0 AND total > 0;

  CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);

  -- ── 6. Rename purchase_order_items columns (only if old names still exist) ─
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='description'
               AND (SELECT data_type FROM information_schema.columns
                    WHERE table_name='purchase_order_items' AND column_name='description') = 'character varying') THEN
    -- 'description' column exists as varchar — rename to item_name only if item_name doesn't exist yet
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='purchase_order_items' AND column_name='item_name') THEN
      ALTER TABLE purchase_order_items RENAME COLUMN description TO item_name;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='qty') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN qty       TO qty_ordered;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='unit_cost') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN unit_cost TO unit_price;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='purchase_order_items' AND column_name='amount') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN amount    TO line_total;
  END IF;

  ALTER TABLE purchase_order_items
    ADD COLUMN IF NOT EXISTS product_id       UUID          REFERENCES products(id),
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

  UPDATE purchase_order_items SET description = item_name WHERE description IS NULL;

  -- ── 7. New support tables (idempotent) ────────────────────────────────────
  CREATE TABLE IF NOT EXISTS po_attachments (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id       UUID         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    filename    VARCHAR(255) NOT NULL,
    file_url    TEXT         NOT NULL,
    file_size   INTEGER,
    mime_type   VARCHAR(100),
    uploaded_by UUID         REFERENCES users(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_po_attachments_po ON po_attachments(po_id);

  CREATE TABLE IF NOT EXISTS po_status_history (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id       UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status   VARCHAR(50) NOT NULL,
    changed_by  UUID        REFERENCES users(id),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_po_status_history_po ON po_status_history(po_id);

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

END;
$migrate$;
