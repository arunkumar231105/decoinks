-- ============================================================
--  008_purchase_orders_enhance.sql
--  Brings purchase_orders up to the state the service code
--  expects (columns from 002_supplier_rename that were never
--  applied to this DB) + pipeline-required additions:
--  language (en/zh) and sent_at.
--
--  Also fully remaps purchase_order_items columns to match
--  the service layer (po.service.js).
-- ============================================================

-- ── 1. Expand po_status enum ──────────────────────────────────

CREATE TYPE po_status_new AS ENUM (
  'Draft',
  'Sent',
  'Accepted',
  'In Production',
  'Shipped',
  'Received',
  'Partial',
  'Pending Approval',
  'Approved',
  'Partially Received',
  'Closed',
  'Cancelled'
);

ALTER TABLE purchase_orders
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE purchase_orders
  ALTER COLUMN status TYPE po_status_new
  USING (status::text::po_status_new);

DROP TYPE po_status;
ALTER TYPE po_status_new RENAME TO po_status;

ALTER TABLE purchase_orders
  ALTER COLUMN status SET DEFAULT 'Draft'::po_status;

-- ── 2. Enhance purchase_orders columns ───────────────────────

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

-- Backfill grand_total from total for existing rows
UPDATE purchase_orders SET grand_total = total WHERE grand_total = 0 AND total > 0;

-- ── 3. Indexes on purchase_orders ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_order_id ON purchase_orders(order_id)    WHERE order_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_language ON purchase_orders(language);

-- ── 4. Rename + expand purchase_order_items ───────────────────
--
--  Original columns:   description, qty, unit_cost, amount
--  Service expects:    item_name, qty_ordered, unit_price, line_total
--                      + product_id, description(TEXT), hsn_code, uom,
--                        discount_pct, discount_amt, tax_pct, tax_amt,
--                        required_by_date, remarks, sort_order, created_at

-- Rename existing columns only if old names still exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' AND column_name = 'description'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE purchase_order_items RENAME COLUMN description TO item_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' AND column_name = 'qty'
  ) THEN
    ALTER TABLE purchase_order_items RENAME COLUMN qty       TO qty_ordered;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' AND column_name = 'unit_cost'
  ) THEN
    ALTER TABLE purchase_order_items RENAME COLUMN unit_cost  TO unit_price;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_items' AND column_name = 'amount'
  ) THEN
    ALTER TABLE purchase_order_items RENAME COLUMN amount     TO line_total;
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

-- Backfill description from item_name for existing rows
UPDATE purchase_order_items SET description = item_name WHERE description IS NULL;

-- ── 5. Support tables (from 002 that were never applied) ──────

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

CREATE TABLE IF NOT EXISTS po_status_history (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id       UUID         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status   VARCHAR(50)  NOT NULL,
  changed_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_status_history_po ON po_status_history(po_id);
