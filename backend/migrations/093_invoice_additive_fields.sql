-- 093_invoice_additive_fields.sql
-- Additive-only enrichment of the invoice line-item model. No column is
-- dropped, renamed or retyped, and no existing row is touched, so this is
-- safe to apply on top of live data with zero data loss and zero behaviour
-- change (every new column is nullable or carries a default).
--
--   1. invoice_items gains four line-level fields that the current single
--      table could not express:
--        - width_in / height_in : real numeric DTF transfer dimensions
--          (previously only encoded inside the free-text `sizes` string,
--          from which an area could not be reliably derived).
--        - taxable              : per-line tax applicability. Defaults TRUE
--          so existing lines keep today's "everything is taxable at the
--          invoice level" behaviour.
--        - notes                : per-line instructions.
--
--   2. invoice_item_artworks : a new bridge table linking an invoice line to
--      the real Artwork Module (artworks / artwork_versions). Because the
--      invoice keeps a single unified invoice_items table, the bridge needs
--      only one item pointer (invoice_item_id) — no polymorphic
--      apparel/dtf discriminator is required.

-- ── 1. invoice_items new columns ──────────────────────────────────────────────
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS width_in  NUMERIC(6,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS height_in NUMERIC(6,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS notes     TEXT;

-- ── 2. invoice_item_artworks bridge table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_item_artworks (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id         UUID          NOT NULL REFERENCES invoices(id)        ON DELETE CASCADE,
  invoice_item_id    UUID          NOT NULL REFERENCES invoice_items(id)   ON DELETE CASCADE,
  artwork_id         UUID          NOT NULL REFERENCES artworks(id)        ON DELETE CASCADE,
  artwork_version_id UUID          REFERENCES artwork_versions(id)         ON DELETE SET NULL,
  placement          VARCHAR(50),
  width_in           NUMERIC(6,2),
  height_in          NUMERIC(6,2),
  quantity           INTEGER,
  display_order      INTEGER       NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_invoice
  ON invoice_item_artworks (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_item
  ON invoice_item_artworks (invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_item_artworks_artwork
  ON invoice_item_artworks (artwork_id);
