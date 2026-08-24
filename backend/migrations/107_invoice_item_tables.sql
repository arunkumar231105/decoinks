-- 107_invoice_item_tables.sql
--
-- The invoice side of the same split migration 106 made for quotations: one
-- invoice_items table today holds apparel and DTF lines in a row shape that fits
-- neither, so sizes are free text and artwork lives in image columns.
--
-- Adds, to the owner's specification:
--   invoice_items_apparel   one row per style + colour + SIZE
--   invoice_items_dtf       one row per transfer: size, quantity, rate
--
-- Two tables the specification also lists already exist and are NOT recreated:
--   invoice_item_artworks   present but pointing only at the old invoice_items;
--                           extended below to reach the new tables
--   payments                the invoice payments ledger, 92 rows, linked by
--                           invoice_id. This is "invoice_payments" under its
--                           existing name; a second payments table would split
--                           the money in two.
--
-- SOURCE TRACEABILITY. Each line records the quotation line it came from, so the
-- chain quote → invoice → sales order can be followed in either direction. The
-- link is nullable: an invoice raised without a quotation is normal here, and
-- sixty-nine of the current invoices have no quote at all.
--
-- ADDITIVE. invoice_items keeps all 319 existing lines and nothing reads the new
-- tables until code is written for them.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_shipping_address ON invoices(shipping_address_id)
  WHERE shipping_address_id IS NOT NULL;

-- ── Apparel lines ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items_apparel (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id                  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- Where this line came from. Nullable: an invoice can be raised directly.
  quotation_apparel_item_id   UUID REFERENCES quotation_items_apparel(id) ON DELETE SET NULL,
  line_no                     INTEGER NOT NULL DEFAULT 0,
  style_no                    VARCHAR(60)  NOT NULL,
  item_description            VARCHAR(255) NOT NULL,
  color                       VARCHAR(80)  NOT NULL,
  size                        VARCHAR(40)  NOT NULL,
  quantity                    INTEGER      NOT NULL CHECK (quantity > 0),
  unit_rate                   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_discount               NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable                     BOOLEAN      NOT NULL DEFAULT TRUE,
  notes                       TEXT,
  catalog_style_id            UUID,
  catalog_color_id            UUID,
  catalog_size_id             UUID,
  catalog_sku                 VARCHAR(100),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_apparel_invoice ON invoice_items_apparel(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_apparel_source  ON invoice_items_apparel(quotation_apparel_item_id)
  WHERE quotation_apparel_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_apparel_group
  ON invoice_items_apparel(invoice_id, line_no, style_no, color);

-- ── DTF transfer lines ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items_dtf (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  quotation_dtf_item_id UUID REFERENCES quotation_items_dtf(id) ON DELETE SET NULL,
  line_no               INTEGER NOT NULL DEFAULT 0,
  item_description      VARCHAR(255) NOT NULL DEFAULT 'DTF Transfers',
  width_in              NUMERIC(6,2) NOT NULL CHECK (width_in  > 0),
  height_in             NUMERIC(6,2) NOT NULL CHECK (height_in > 0),
  quantity              INTEGER      NOT NULL CHECK (quantity > 0),
  unit_of_measure       VARCHAR(10)  NOT NULL DEFAULT 'PCS' CHECK (unit_of_measure IN ('PCS','FT')),
  unit_rate             NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_discount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable               BOOLEAN      NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_dtf_invoice ON invoice_items_dtf(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_dtf_source  ON invoice_items_dtf(quotation_dtf_item_id)
  WHERE quotation_dtf_item_id IS NOT NULL;

-- ── Teach the artwork link about the new tables ─────────────────────────────
-- invoice_item_artworks was built to point at invoice_items only, and its
-- invoice_item_id is NOT NULL. The table is empty, so relaxing that and adding
-- the two new targets costs nothing and keeps one artwork link table for the
-- invoice rather than a second one beside it.
ALTER TABLE invoice_item_artworks ALTER COLUMN invoice_item_id DROP NOT NULL;
ALTER TABLE invoice_item_artworks
  ADD COLUMN IF NOT EXISTS item_type       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS apparel_item_id UUID REFERENCES invoice_items_apparel(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS dtf_item_id     UUID REFERENCES invoice_items_dtf(id)     ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS quantity_check_placeholder BOOLEAN;
ALTER TABLE invoice_item_artworks DROP COLUMN IF EXISTS quantity_check_placeholder;

CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_apparel ON invoice_item_artworks(apparel_item_id)
  WHERE apparel_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_dtf ON invoice_item_artworks(dtf_item_id)
  WHERE dtf_item_id IS NOT NULL;

-- Exactly one target, and item_type must agree with it. The old invoice_item_id
-- is still accepted so anything written against the current shape keeps working.
ALTER TABLE invoice_item_artworks DROP CONSTRAINT IF EXISTS chk_invoice_item_artworks_target;
ALTER TABLE invoice_item_artworks ADD CONSTRAINT chk_invoice_item_artworks_target CHECK (
  (item_type = 'APPAREL'      AND apparel_item_id IS NOT NULL AND dtf_item_id IS NULL AND invoice_item_id IS NULL) OR
  (item_type = 'DTF_TRANSFER' AND dtf_item_id IS NOT NULL AND apparel_item_id IS NULL AND invoice_item_id IS NULL) OR
  (item_type IS NULL AND invoice_item_id IS NOT NULL AND apparel_item_id IS NULL AND dtf_item_id IS NULL)
);

DROP TRIGGER IF EXISTS trg_invoice_items_apparel_updated_at ON invoice_items_apparel;
CREATE TRIGGER trg_invoice_items_apparel_updated_at
  BEFORE UPDATE ON invoice_items_apparel FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_invoice_items_dtf_updated_at ON invoice_items_dtf;
CREATE TRIGGER trg_invoice_items_dtf_updated_at
  BEFORE UPDATE ON invoice_items_dtf FOR EACH ROW EXECUTE FUNCTION set_updated_at();
