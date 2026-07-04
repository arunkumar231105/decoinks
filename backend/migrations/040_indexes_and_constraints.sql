-- ============================================================
--  040_indexes_and_constraints.sql
--
--  1) Adds the missing foreign-key indexes (child-row lookups were
--     sequential scans on several hot paths).
--  2) Drops indexes that duplicate a UNIQUE constraint's own index.
--  3) Adds CHECK constraints guarding quantities and money columns.
--     Constraints are added NOT VALID first (so the migration never
--     fails because of pre-existing bad rows) and then validated in a
--     guarded block; if legacy rows violate a constraint the constraint
--     stays NOT VALID (new writes are still enforced) and a NOTICE is
--     raised instead of aborting the deploy.
-- ============================================================

-- ── 1. Missing FK / lookup indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_oia_order             ON order_items_apparel(order_id);
CREATE INDEX IF NOT EXISTS idx_oig_order             ON order_items_gangsheet(order_id);
CREATE INDEX IF NOT EXISTS idx_oid_order             ON order_items_dtf(order_id);
CREATE INDEX IF NOT EXISTS idx_lead_comments_lead    ON lead_comments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead ON lead_attachments(lead_id);

CREATE INDEX IF NOT EXISTS idx_invoices_order        ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date     ON invoices(due_date) WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_order       ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status      ON shipments(status);

CREATE INDEX IF NOT EXISTS idx_orders_quotation      ON orders(quotation_id) WHERE quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotations_status     ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_lead_id    ON quotations(lead_id);
CREATE INDEX IF NOT EXISTS idx_po_status             ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_cfv_field             ON custom_field_values(field_id);
CREATE INDEX IF NOT EXISTS idx_artworks_status       ON artworks(status);

-- Columns whose existence depends on which schema path the DB took —
-- index them only if they exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='invoices' AND column_name='supplier_id') THEN
    CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='shipments' AND column_name='supplier_id') THEN
    CREATE INDEX IF NOT EXISTS idx_shipments_supplier ON shipments(supplier_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='artworks' AND column_name='supplier_id') THEN
    CREATE INDEX IF NOT EXISTS idx_artworks_supplier ON artworks(supplier_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='orders' AND column_name='supplier_id') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id) WHERE deleted_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='quotations' AND column_name='supplier_id') THEN
    CREATE INDEX IF NOT EXISTS idx_quotations_supplier ON quotations(supplier_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='quotations' AND column_name='customer_id') THEN
    CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='leads' AND column_name='customer_id') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_customer_id ON leads(customer_id) WHERE deleted_at IS NULL;
  END IF;
END $$;

-- ── 2. Drop indexes that duplicate a UNIQUE constraint ───────────────────────
DROP INDEX IF EXISTS idx_users_email;    -- users.email is UNIQUE
DROP INDEX IF EXISTS idx_products_sku;   -- products.sku is UNIQUE
DROP INDEX IF EXISTS idx_rt_hash;        -- refresh_tokens.token_hash is UNIQUE

-- ── 3. CHECK constraints (NOT VALID + guarded VALIDATE) ──────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('quotation_items',      'chk_qi_qty_nonneg',    'qty >= 0'),
      ('quotation_items',      'chk_qi_price_nonneg',  'unit_price >= 0'),
      ('order_items_apparel',  'chk_oia_qty_nonneg',   'qty >= 0'),
      ('order_items_apparel',  'chk_oia_price_nonneg', 'unit_price >= 0'),
      ('order_items_gangsheet','chk_oig_qty_nonneg',   'qty >= 0'),
      ('order_items_gangsheet','chk_oig_price_nonneg', 'price_per_sheet >= 0'),
      ('order_items_dtf',      'chk_oid_qty_nonneg',   'qty >= 0'),
      ('order_items_dtf',      'chk_oid_price_nonneg', 'unit_price >= 0'),
      ('invoice_items',        'chk_ii_qty_nonneg',    'qty >= 0'),
      ('invoice_items',        'chk_ii_price_nonneg',  'unit_price >= 0'),
      ('purchase_order_items', 'chk_poi_qty_nonneg',   'qty_ordered >= 0'),
      ('purchase_order_items', 'chk_poi_price_nonneg', 'unit_price >= 0'),
      ('invoices',             'chk_inv_paid_nonneg',  'amount_paid >= 0'),
      ('invoices',             'chk_inv_total_nonneg', 'total >= 0'),
      ('quotations',           'chk_q_total_nonneg',   'total >= 0'),
      ('orders',               'chk_o_total_nonneg',   'total >= 0'),
      ('payments',             'chk_pay_amount_pos',   'amount > 0')
    ) AS v(tbl, cname, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.cname) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                     r.tbl, r.cname, r.expr);
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.tbl, r.cname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Constraint % on % left NOT VALID — existing rows violate it; new writes are still enforced',
        r.cname, r.tbl;
    END;
  END LOOP;
END $$;
