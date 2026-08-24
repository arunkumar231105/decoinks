-- 106_quotation_item_tables.sql
--
-- The quotation module keeps every line in one quotation_items table, whatever
-- the product is: an apparel line and a DTF transfer share a row shape that fits
-- neither. Sizes end up as free text, artwork lives in three image columns, and
-- converting a quote to an invoice means reading those columns back out and
-- guessing what they meant.
--
-- This adds the shape the owner specified, alongside what is already there:
--
--   quotation_items_apparel     one row per style + colour + SIZE, so a quote for
--                               S:10 M:20 L:15 XL:5 is four rows the shop can
--                               price and count, and the page groups them back
--                               into one line for the customer to read.
--   quotation_items_dtf         one row per transfer: size, quantity, rate.
--   quotation_item_artworks     which artwork belongs to which line, pointing at
--                               the artwork module rather than copying files or
--                               statuses into the quotation.
--
-- ADDITIVE ONLY. quotation_items is untouched and still holds all 306 existing
-- lines; nothing reads the new tables until code is written for them, so this
-- migration cannot change how the app behaves today. The one column added to
-- quotations is nullable with no default, so every existing row stays valid.
--
-- WHAT WAS ADJUSTED FROM THE SPEC, AND WHY:
--
--  * lead_id was specified as required. Two of the ninety-nine live quotations
--    have one — the rest come from customers who walked in already known. It is
--    left nullable on the existing header; making it required would invalidate
--    ninety-seven rows and block every walk-in quote.
--
--  * unit_rate is numeric(12,4), not (12,2). The shop quotes 2.037 a transfer;
--    migration 105 widened the rate columns for exactly this reason and a new
--    table starting at two decimals would reintroduce the bug. Money columns —
--    line_discount, line_amount — stay at two decimals, because a customer is
--    billed whole cents.
--
--  * The artwork link carries a CHECK that ties item_type to the item it points
--    at, so an apparel artwork cannot be attached to a DTF line, and a row
--    cannot point at nothing.
--
--  * There is no quotation_items_gangsheet. The spec does not include one and no
--    live quotation uses that type today, but order_items_gangsheet exists and
--    the quotation order_type enum still allows 'gangsheet', so a gangsheet
--    quote currently has nowhere to go in this structure. Noted deliberately.

-- ── Header: link the quote to a real customer address ───────────────────────
-- Addresses are held on the customer, so the quotation should point at one
-- rather than keep its own copy of the street.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotations_shipping_address ON quotations(shipping_address_id)
  WHERE shipping_address_id IS NOT NULL;

-- ── Apparel lines ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_items_apparel (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id      UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL DEFAULT 0,
  style_no          VARCHAR(60)  NOT NULL,
  item_description  VARCHAR(255) NOT NULL,
  color             VARCHAR(80)  NOT NULL,
  size              VARCHAR(40)  NOT NULL,
  quantity          INTEGER      NOT NULL CHECK (quantity > 0),
  unit_rate         NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_discount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable           BOOLEAN      NOT NULL DEFAULT TRUE,
  notes             TEXT,
  -- Catalogue keys, matching order_items_apparel, so accepting a quote copies
  -- the line across instead of looking the product up again.
  catalog_style_id  UUID,
  catalog_color_id  UUID,
  catalog_size_id   UUID,
  catalog_sku       VARCHAR(100),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_apparel_quotation ON quotation_items_apparel(quotation_id);
-- The customer-facing line is the group; this is the order the page reads them in.
CREATE INDEX IF NOT EXISTS idx_quotation_items_apparel_group
  ON quotation_items_apparel(quotation_id, line_no, style_no, color);

-- ── DTF transfer lines ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_items_dtf (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id      UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL DEFAULT 0,
  item_description  VARCHAR(255) NOT NULL DEFAULT 'DTF Transfers',
  width_in          NUMERIC(6,2) NOT NULL CHECK (width_in  > 0),
  height_in         NUMERIC(6,2) NOT NULL CHECK (height_in > 0),
  quantity          INTEGER      NOT NULL CHECK (quantity > 0),
  unit_of_measure   VARCHAR(10)  NOT NULL DEFAULT 'PCS' CHECK (unit_of_measure IN ('PCS','FT')),
  unit_rate         NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  line_discount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable           BOOLEAN      NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_dtf_quotation ON quotation_items_dtf(quotation_id);

-- ── Which artwork belongs to which line ─────────────────────────────────────
-- Mirrors invoice_item_artworks and po_item_artworks, so the same relationship
-- carries from quote to invoice to purchase order without being re-modelled.
CREATE TABLE IF NOT EXISTS quotation_item_artworks (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id       UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_type          VARCHAR(20) NOT NULL CHECK (item_type IN ('APPAREL','DTF_TRANSFER')),
  apparel_item_id    UUID REFERENCES quotation_items_apparel(id) ON DELETE CASCADE,
  dtf_item_id        UUID REFERENCES quotation_items_dtf(id)     ON DELETE CASCADE,
  artwork_id         UUID NOT NULL REFERENCES artworks(id)         ON DELETE CASCADE,
  artwork_version_id UUID          REFERENCES artwork_versions(id) ON DELETE SET NULL,
  placement          VARCHAR(50),
  width_in           NUMERIC(6,2),
  height_in          NUMERIC(6,2),
  display_order      INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The row must point at exactly one line, and at the kind it says it does.
  CONSTRAINT chk_quotation_item_artworks_target CHECK (
    (item_type = 'APPAREL'      AND apparel_item_id IS NOT NULL AND dtf_item_id     IS NULL) OR
    (item_type = 'DTF_TRANSFER' AND dtf_item_id     IS NOT NULL AND apparel_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_quotation_item_artworks_quotation ON quotation_item_artworks(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_item_artworks_artwork   ON quotation_item_artworks(artwork_id);
CREATE INDEX IF NOT EXISTS idx_quotation_item_artworks_apparel   ON quotation_item_artworks(apparel_item_id)
  WHERE apparel_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotation_item_artworks_dtf       ON quotation_item_artworks(dtf_item_id)
  WHERE dtf_item_id IS NOT NULL;

-- Keep updated_at honest, the same way every other table here does.
DROP TRIGGER IF EXISTS trg_quotation_items_apparel_updated_at ON quotation_items_apparel;
CREATE TRIGGER trg_quotation_items_apparel_updated_at
  BEFORE UPDATE ON quotation_items_apparel
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_quotation_items_dtf_updated_at ON quotation_items_dtf;
CREATE TRIGGER trg_quotation_items_dtf_updated_at
  BEFORE UPDATE ON quotation_items_dtf
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
