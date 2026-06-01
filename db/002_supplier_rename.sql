-- ============================================================
--  002_supplier_rename.sql
--  Migration: customer → supplier rename + PO enhancements
--
--  IMPORTANT: Run ENUM additions first (outside transaction),
--  then run the main transaction block.
--  Usage:
--    psql $DATABASE_URL -f 002_supplier_rename.sql
-- ============================================================

-- ── Step 0: ENUM additions (MUST be outside a transaction) ───
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Partially Received';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Closed';

-- ── Main migration (transactional) ───────────────────────────
BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Rename customers table, type, and indexes
-- ────────────────────────────────────────────────────────────
ALTER TYPE customer_status RENAME TO supplier_status;
ALTER TABLE customers RENAME TO suppliers;
ALTER INDEX idx_customers_email  RENAME TO idx_suppliers_email;
ALTER INDEX idx_customers_status RENAME TO idx_suppliers_status;

-- ────────────────────────────────────────────────────────────
-- 2. Rename customer_id FK columns in dependent tables
-- ────────────────────────────────────────────────────────────

-- leads
ALTER TABLE leads RENAME COLUMN customer_id   TO supplier_id;
ALTER TABLE leads RENAME COLUMN customer_name TO supplier_name;
ALTER INDEX idx_leads_customer RENAME TO idx_leads_supplier;

-- quotations
ALTER TABLE quotations RENAME COLUMN customer_id TO supplier_id;

-- orders
ALTER TABLE orders RENAME COLUMN customer_id TO supplier_id;
ALTER INDEX idx_orders_customer RENAME TO idx_orders_supplier;

-- invoices
ALTER TABLE invoices RENAME COLUMN customer_id TO supplier_id;

-- shipments
ALTER TABLE shipments RENAME COLUMN customer_id TO supplier_id;

-- artworks
ALTER TABLE artworks RENAME COLUMN customer_id TO supplier_id;

-- ────────────────────────────────────────────────────────────
-- 3. Rename portal tables and their columns / indexes
-- ────────────────────────────────────────────────────────────
ALTER TABLE customer_portal_users RENAME TO supplier_portal_users;
ALTER TABLE supplier_portal_users RENAME COLUMN customer_id TO supplier_id;
ALTER INDEX idx_portal_users_customer  RENAME TO idx_portal_users_supplier;
ALTER INDEX idx_portal_users_username  RENAME TO idx_supplier_portal_users_username;

ALTER TABLE portal_order_visibility RENAME COLUMN customer_id TO supplier_id;
ALTER INDEX idx_portal_vis_customer    RENAME TO idx_portal_vis_supplier;

ALTER TABLE portal_po_visibility    RENAME COLUMN customer_id TO supplier_id;
ALTER INDEX idx_portal_po_vis_customer RENAME TO idx_portal_po_vis_supplier;

ALTER TABLE portal_notifications    RENAME COLUMN customer_id TO supplier_id;
ALTER INDEX idx_portal_notif_customer  RENAME TO idx_portal_notif_supplier;

-- ────────────────────────────────────────────────────────────
-- 4. Data migration: activity_logs entity_type
-- ────────────────────────────────────────────────────────────
UPDATE activity_logs SET entity_type = 'supplier' WHERE entity_type = 'customer';

-- ────────────────────────────────────────────────────────────
-- 5. Enhance purchase_orders table
-- ────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN supplier_id        UUID          REFERENCES suppliers(id),
  ADD COLUMN supplier_reference VARCHAR(100),
  ADD COLUMN payment_terms      VARCHAR(50),
  ADD COLUMN currency           VARCHAR(3)    NOT NULL DEFAULT 'USD',
  ADD COLUMN exchange_rate      NUMERIC(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN buyer_id           UUID          REFERENCES users(id),
  ADD COLUMN department         VARCHAR(100),
  ADD COLUMN priority           VARCHAR(10)   NOT NULL DEFAULT 'Medium'
                                  CHECK (priority IN ('Low','Medium','High','Urgent')),
  ADD COLUMN shipping_method    VARCHAR(50),
  ADD COLUMN shipping_address   TEXT,
  ADD COLUMN billing_address    TEXT,
  ADD COLUMN terms_conditions   TEXT,
  ADD COLUMN approved_by        UUID          REFERENCES users(id),
  ADD COLUMN approved_at        TIMESTAMPTZ,
  ADD COLUMN cancelled_reason   TEXT,
  ADD COLUMN total_discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_tax          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN freight_charges    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN other_charges      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN grand_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at         TIMESTAMPTZ,
  ADD COLUMN order_id           UUID          REFERENCES orders(id);

-- Backfill grand_total from existing total column
UPDATE purchase_orders SET grand_total = total WHERE grand_total = 0 AND total > 0;

CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);

-- ────────────────────────────────────────────────────────────
-- 6. Rename purchase_order_items columns + add new ones
-- ────────────────────────────────────────────────────────────
ALTER TABLE purchase_order_items RENAME COLUMN description TO item_name;
ALTER TABLE purchase_order_items RENAME COLUMN qty         TO qty_ordered;
ALTER TABLE purchase_order_items RENAME COLUMN unit_cost   TO unit_price;
ALTER TABLE purchase_order_items RENAME COLUMN amount      TO line_total;

ALTER TABLE purchase_order_items
  ADD COLUMN product_id        UUID          REFERENCES products(id),
  ADD COLUMN description       TEXT,
  ADD COLUMN hsn_code          VARCHAR(20),
  ADD COLUMN uom               VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  ADD COLUMN discount_pct      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN discount_amt      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_pct           NUMERIC(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN tax_amt           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN required_by_date  DATE,
  ADD COLUMN remarks           TEXT,
  ADD COLUMN sort_order        INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- Backfill line_total into grand_total equivalent for existing items
UPDATE purchase_order_items SET description = item_name WHERE description IS NULL;

-- ────────────────────────────────────────────────────────────
-- 7. New support tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE po_attachments (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  filename    VARCHAR(255) NOT NULL,
  file_url    TEXT         NOT NULL,
  file_size   INTEGER,
  mime_type   VARCHAR(100),
  uploaded_by UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_attachments_po ON po_attachments(po_id);

CREATE TABLE po_status_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status   VARCHAR(50) NOT NULL,
  changed_by  UUID        REFERENCES users(id),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_status_history_po ON po_status_history(po_id);

CREATE TABLE portal_status_updates (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID        NOT NULL REFERENCES orders(id)     ON DELETE CASCADE,
  supplier_id  UUID        NOT NULL REFERENCES suppliers(id)  ON DELETE CASCADE,
  status       VARCHAR(50) NOT NULL,
  notes        TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_portal_status_updates_order    ON portal_status_updates(order_id);
CREATE INDEX idx_portal_status_updates_supplier ON portal_status_updates(supplier_id);

COMMIT;
