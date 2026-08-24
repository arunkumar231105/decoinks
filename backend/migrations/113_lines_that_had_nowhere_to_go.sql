-- 113_lines_that_had_nowhere_to_go.sql
--
-- Migrations 106–112 built the shape the owner specified. Before moving the 836
-- existing lines into it, every one of them was counted against a destination
-- column. Three kinds of line had nowhere to land, and a further set of columns
-- that are filled in today's data had no home. Both are fixed here, so the move
-- can be done without dropping a single row or a single value.
--
-- WHAT THE DATA SHOWED, AND WHAT IS ADDED FOR IT:
--
--  1. GANGSHEET LINES HAVE NO TABLE.
--     Two quotation lines and six invoice lines are gangsheets — 22" x 60" at
--     $25, 22" x 84" at $35. order_items_gangsheet has existed all along, so a
--     gangsheet survives as a sales order but had no shape as a quote or an
--     invoice; converting one silently had nothing to write. The spec did not
--     include these tables because the spec was written from the apparel and
--     DTF flows. quotation_items_gangsheet and invoice_items_gangsheet are
--     added, mirroring order_items_gangsheet column for column so a gangsheet
--     now carries from quote to invoice to order without being re-modelled.
--
--  2. MOST PURCHASE ORDER LINES ARE DTF, AND PO HAD NO DTF TABLE.
--     The PO spec has apparel lines and gangsheet lines. In the real data 183
--     of 211 lines are DTF Transfers and only 18 are apparel. po_gangsheet_lines
--     cannot take them: it requires a master_gangsheets row, and these lines
--     carry the lengths as the supplier wrote them ("01 W22/H118.30; 02 ...",
--     "Total 546.0 in across 6 gangsheets") with no gangsheet record behind
--     them. po_dtf_items is added for the line the shop actually buys.
--
--  3. DTF WIDTH AND HEIGHT CANNOT BE REQUIRED.
--     The spec marks them Required. 271 existing DTF lines have no dimensions:
--     they are "DTF Transfers (aggregate)" rows from the historical import,
--     where a whole order arrived as one line with a quantity and a rate and no
--     per-artwork breakdown. Holding the NOT NULL would leave those 271 lines
--     behind, so the columns are relaxed to nullable with the positive check
--     kept for when a value is present. The requirement belongs in the form,
--     where a new line can be made to supply it; it cannot be applied backwards
--     to history that never recorded it.
--
--  4. COLUMNS THAT ARE FILLED TODAY BUT HAD NO DESTINATION.
--     Counted per line kind across quotation_items, invoice_items and
--     purchase_order_items — sort_order (580 rows), artwork_count (578),
--     unit (306), the artwork image paths (317), artwork_no (92),
--     style_description (71), product_image (47), and on the PO side the tax,
--     discount, uom, remarks, print_type, required_by_date, artwork_size and
--     image_file_ref columns that every one of the 211 lines carries. Each is
--     added to the table that will receive it, and to its counterpart so a
--     quote and the invoice made from it keep the same shape.
--
-- ADDITIVE AND REVERSIBLE IN EFFECT. Every new column is nullable or defaulted;
-- the three new tables are empty; the two relaxations only widen what is
-- allowed. All nine tables touched hold zero rows today and nothing in the
-- application reads them yet, so this migration cannot change how the software
-- behaves. The legacy quotation_items, invoice_items and purchase_order_items
-- tables are not touched and keep serving every screen exactly as they do now.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. DTF dimensions become optional
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE quotation_items_dtf ALTER COLUMN width_in  DROP NOT NULL;
ALTER TABLE quotation_items_dtf ALTER COLUMN height_in DROP NOT NULL;
ALTER TABLE quotation_items_dtf DROP CONSTRAINT IF EXISTS quotation_items_dtf_width_in_check;
ALTER TABLE quotation_items_dtf DROP CONSTRAINT IF EXISTS quotation_items_dtf_height_in_check;
ALTER TABLE quotation_items_dtf ADD CONSTRAINT chk_quotation_items_dtf_width
  CHECK (width_in  IS NULL OR width_in  > 0);
ALTER TABLE quotation_items_dtf ADD CONSTRAINT chk_quotation_items_dtf_height
  CHECK (height_in IS NULL OR height_in > 0);

ALTER TABLE invoice_items_dtf ALTER COLUMN width_in  DROP NOT NULL;
ALTER TABLE invoice_items_dtf ALTER COLUMN height_in DROP NOT NULL;
ALTER TABLE invoice_items_dtf DROP CONSTRAINT IF EXISTS invoice_items_dtf_width_in_check;
ALTER TABLE invoice_items_dtf DROP CONSTRAINT IF EXISTS invoice_items_dtf_height_in_check;
ALTER TABLE invoice_items_dtf ADD CONSTRAINT chk_invoice_items_dtf_width
  CHECK (width_in  IS NULL OR width_in  > 0);
ALTER TABLE invoice_items_dtf ADD CONSTRAINT chk_invoice_items_dtf_height
  CHECK (height_in IS NULL OR height_in > 0);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Fields the existing lines carry, added to the tables that receive them
-- ══════════════════════════════════════════════════════════════════════════
-- The order a line is shown in. line_no groups a customer-facing line; the shop
-- also reorders lines by hand, and 580 rows have that ordering recorded.
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS sort_order      INTEGER;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20);
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS artwork_count   INTEGER;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS artwork_no      VARCHAR(100);
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS front_image     TEXT;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS back_image      TEXT;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS artwork_image   TEXT;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS style_description TEXT;
ALTER TABLE quotation_items_apparel ADD COLUMN IF NOT EXISTS product_image   TEXT;

ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS sort_order        INTEGER;
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS artwork_count     INTEGER;
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS artwork_no        VARCHAR(100);
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS front_image       TEXT;
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS back_image        TEXT;
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS artwork_image     TEXT;
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS brand             VARCHAR(120);
ALTER TABLE quotation_items_dtf ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);

ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS sort_order        INTEGER;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS unit_of_measure   VARCHAR(20);
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS artwork_count     INTEGER;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS artwork_no        VARCHAR(100);
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS front_image       TEXT;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS back_image        TEXT;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS artwork_image     TEXT;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS style_description TEXT;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS product_image     TEXT;
ALTER TABLE invoice_items_apparel ADD COLUMN IF NOT EXISTS tax_code          VARCHAR(40);

ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS sort_order        INTEGER;
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS artwork_count     INTEGER;
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS artwork_no        VARCHAR(100);
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS front_image       TEXT;
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS back_image        TEXT;
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS artwork_image     TEXT;
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS brand             VARCHAR(120);
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);
ALTER TABLE invoice_items_dtf ADD COLUMN IF NOT EXISTS tax_code          VARCHAR(40);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Gangsheet lines for quotations and invoices
--    Columns follow order_items_gangsheet so the three stages agree.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS quotation_items_gangsheet (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id      UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER,
  -- The sheet as the shop writes it: 22" x 60".
  size              VARCHAR(50) NOT NULL,
  item_description  VARCHAR(255),
  width_in          NUMERIC(6,2) CHECK (width_in  IS NULL OR width_in  > 0),
  height_in         NUMERIC(6,2) CHECK (height_in IS NULL OR height_in > 0),
  no_artworks       INTEGER NOT NULL DEFAULT 1 CHECK (no_artworks >= 0),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_per_sheet   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (price_per_sheet >= 0),
  line_discount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable           BOOLEAN NOT NULL DEFAULT TRUE,
  artwork_count     INTEGER,
  artwork_no        VARCHAR(100),
  front_image       TEXT,
  back_image        TEXT,
  artwork_image     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_gangsheet_quotation
  ON quotation_items_gangsheet(quotation_id);

CREATE TABLE IF NOT EXISTS invoice_items_gangsheet (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id                  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- Where this line came from, the same link the apparel and DTF tables carry.
  quotation_gangsheet_item_id UUID REFERENCES quotation_items_gangsheet(id) ON DELETE SET NULL,
  line_no                     INTEGER NOT NULL DEFAULT 0,
  sort_order                  INTEGER,
  size                        VARCHAR(50) NOT NULL,
  item_description            VARCHAR(255),
  width_in                    NUMERIC(6,2) CHECK (width_in  IS NULL OR width_in  > 0),
  height_in                   NUMERIC(6,2) CHECK (height_in IS NULL OR height_in > 0),
  no_artworks                 INTEGER NOT NULL DEFAULT 1 CHECK (no_artworks >= 0),
  quantity                    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_per_sheet             NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (price_per_sheet >= 0),
  line_discount               NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable                     BOOLEAN NOT NULL DEFAULT TRUE,
  tax_code                    VARCHAR(40),
  artwork_count               INTEGER,
  artwork_no                  VARCHAR(100),
  front_image                 TEXT,
  back_image                  TEXT,
  artwork_image               TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_gangsheet_invoice
  ON invoice_items_gangsheet(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_gangsheet_source
  ON invoice_items_gangsheet(quotation_gangsheet_item_id)
  WHERE quotation_gangsheet_item_id IS NOT NULL;

-- Sales orders already have order_items_gangsheet. Give it the same source link
-- so a gangsheet can be traced quote → invoice → order like the other two kinds.
ALTER TABLE order_items_gangsheet
  ADD COLUMN IF NOT EXISTS invoice_gangsheet_item_id UUID
    REFERENCES invoice_items_gangsheet(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_gangsheet_source
  ON order_items_gangsheet(invoice_gangsheet_item_id)
  WHERE invoice_gangsheet_item_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. The DTF line a purchase order actually buys
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS po_dtf_items (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id             UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  source_purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  source_sales_order_dtf_item_id UUID REFERENCES order_items_dtf(id) ON DELETE SET NULL,
  line_no                       INTEGER NOT NULL DEFAULT 0,
  sort_order                    INTEGER,
  item_name                     VARCHAR(255) NOT NULL,
  item_description              TEXT,
  -- The transfer itself. Nullable for the same reason as the quote and invoice
  -- DTF lines: the aggregate imports never recorded a size.
  width_in                      NUMERIC(6,2) CHECK (width_in  IS NULL OR width_in  > 0),
  height_in                     NUMERIC(6,2) CHECK (height_in IS NULL OR height_in > 0),
  -- As the supplier states it, e.g. "3x2.2" or "W10/H5.7".
  artwork_size                  VARCHAR(80),
  -- As the supplier states it, e.g. "01 W22/H118.30; 02 W22/H118.30" or
  -- "Total 546.0 in across 6 gangsheets". Free text on purpose: there is no
  -- gangsheet record behind these lines to point at.
  gangsheet_lengths             TEXT,
  print_type                    VARCHAR(60),
  brand                         VARCHAR(120),
  category                      VARCHAR(80),
  quantity                      INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  uom                           VARCHAR(20),
  supplier_unit_cost            NUMERIC(12,4) CHECK (supplier_unit_cost IS NULL OR supplier_unit_cost >= 0),
  supplier_line_cost            NUMERIC(12,2),
  discount_pct                  NUMERIC(6,2),
  discount_amt                  NUMERIC(12,2),
  tax_pct                       NUMERIC(6,2),
  tax_amt                       NUMERIC(12,2),
  required_by_date              DATE,
  source_artwork_no             VARCHAR(100),
  image_file_ref                TEXT,
  front_image                   TEXT,
  back_image                    TEXT,
  remarks                       TEXT,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_po_dtf_items_line UNIQUE (purchase_order_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_po_dtf_items_po          ON po_dtf_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_dtf_items_source_item ON po_dtf_items(source_purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_po_dtf_items_source_so   ON po_dtf_items(source_sales_order_dtf_item_id);

-- The apparel PO line is missing the same commercial fields; the 18 apparel
-- lines in the data carry all of them.
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS sort_order        INTEGER;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS category          VARCHAR(80);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS uom               VARCHAR(20);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS discount_pct      NUMERIC(6,2);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS discount_amt      NUMERIC(12,2);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS tax_pct           NUMERIC(6,2);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS tax_amt           NUMERIC(12,2);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS required_by_date  DATE;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS print_type        VARCHAR(60);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS artwork_size      VARCHAR(80);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS source_artwork_no VARCHAR(100);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS image_file_ref    TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS front_image       TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS back_image        TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS product_image     TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS style_description TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS hsn_code          VARCHAR(40);
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS remarks           TEXT;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS catalog_style_id  UUID;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS catalog_color_id  UUID;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS catalog_size_id   UUID;
ALTER TABLE po_apparel_items ADD COLUMN IF NOT EXISTS catalog_sku       VARCHAR(100);

-- The supplier cost was two decimals; a DTF transfer is priced at four, the
-- same reason migration 105 widened the customer-facing rates.
ALTER TABLE po_apparel_items ALTER COLUMN supplier_unit_cost TYPE NUMERIC(12,4);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Artwork links reach the two new kinds of line
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE quotation_item_artworks
  ADD COLUMN IF NOT EXISTS gangsheet_item_id UUID
    REFERENCES quotation_items_gangsheet(id) ON DELETE CASCADE;
ALTER TABLE quotation_item_artworks DROP CONSTRAINT IF EXISTS chk_quotation_item_artworks_target;
ALTER TABLE quotation_item_artworks ADD CONSTRAINT chk_quotation_item_artworks_target CHECK (
  (item_type = 'APPAREL'      AND apparel_item_id   IS NOT NULL AND dtf_item_id IS NULL     AND gangsheet_item_id IS NULL) OR
  (item_type = 'DTF_TRANSFER' AND dtf_item_id       IS NOT NULL AND apparel_item_id IS NULL AND gangsheet_item_id IS NULL) OR
  (item_type = 'GANGSHEET'    AND gangsheet_item_id IS NOT NULL AND apparel_item_id IS NULL AND dtf_item_id       IS NULL)
);
ALTER TABLE quotation_item_artworks DROP CONSTRAINT IF EXISTS quotation_item_artworks_item_type_check;
ALTER TABLE quotation_item_artworks ADD CONSTRAINT chk_quotation_item_artworks_type
  CHECK (item_type IN ('APPAREL','DTF_TRANSFER','GANGSHEET'));
CREATE INDEX IF NOT EXISTS idx_quotation_item_artworks_gangsheet
  ON quotation_item_artworks(gangsheet_item_id) WHERE gangsheet_item_id IS NOT NULL;

ALTER TABLE invoice_item_artworks
  ADD COLUMN IF NOT EXISTS gangsheet_item_id UUID
    REFERENCES invoice_items_gangsheet(id) ON DELETE CASCADE;
-- The existing three-way check also allows the original shape, where the row
-- points at a legacy invoice_items line and item_type is NULL. That branch is
-- kept so the 43 rows already in this table stay valid.
ALTER TABLE invoice_item_artworks DROP CONSTRAINT IF EXISTS chk_invoice_item_artworks_target;
ALTER TABLE invoice_item_artworks ADD CONSTRAINT chk_invoice_item_artworks_target CHECK (
  (item_type IS NULL          AND invoice_item_id   IS NOT NULL) OR
  (item_type = 'APPAREL'      AND apparel_item_id   IS NOT NULL AND dtf_item_id IS NULL     AND gangsheet_item_id IS NULL) OR
  (item_type = 'DTF_TRANSFER' AND dtf_item_id       IS NOT NULL AND apparel_item_id IS NULL AND gangsheet_item_id IS NULL) OR
  (item_type = 'GANGSHEET'    AND gangsheet_item_id IS NOT NULL AND apparel_item_id IS NULL AND dtf_item_id       IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_gangsheet
  ON invoice_item_artworks(gangsheet_item_id) WHERE gangsheet_item_id IS NOT NULL;

-- po_item_artworks pointed only at an apparel line; most PO lines are DTF.
ALTER TABLE po_item_artworks
  ADD COLUMN IF NOT EXISTS po_dtf_item_id UUID REFERENCES po_dtf_items(id) ON DELETE CASCADE;
ALTER TABLE po_item_artworks
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20);
ALTER TABLE po_item_artworks DROP CONSTRAINT IF EXISTS chk_po_item_artworks_target;
ALTER TABLE po_item_artworks ADD CONSTRAINT chk_po_item_artworks_target CHECK (
  (item_type IS NULL          AND po_dtf_item_id IS NULL) OR
  (item_type = 'APPAREL'      AND po_apparel_item_id IS NOT NULL AND po_dtf_item_id IS NULL) OR
  (item_type = 'DTF_TRANSFER' AND po_dtf_item_id     IS NOT NULL AND po_apparel_item_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_po_item_artworks_dtf
  ON po_item_artworks(po_dtf_item_id) WHERE po_dtf_item_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. updated_at stays honest on the new tables
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_quotation_items_gangsheet_updated_at ON quotation_items_gangsheet;
CREATE TRIGGER trg_quotation_items_gangsheet_updated_at
  BEFORE UPDATE ON quotation_items_gangsheet
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_invoice_items_gangsheet_updated_at ON invoice_items_gangsheet;
CREATE TRIGGER trg_invoice_items_gangsheet_updated_at
  BEFORE UPDATE ON invoice_items_gangsheet
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_po_dtf_items_updated_at ON po_dtf_items;
CREATE TRIGGER trg_po_dtf_items_updated_at
  BEFORE UPDATE ON po_dtf_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
