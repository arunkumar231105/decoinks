-- ============================================================
--  044_po_redesign.sql
--
--  Purchase Order module redesign. Normalisation goals:
--    - PO ↔ Orders becomes many-to-many (a gangsheet PO covers several
--      orders; an apparel PO covers exactly one — enforced in service).
--      Covered-order details (qty, artwork count, sheet size, status,
--      agent) are ALWAYS joined from orders/order_items — never copied.
--    - PO ↔ Artworks via junction table; thumbnails/links join from
--      artworks — never copied.
--    - Contact persons become supplier_contacts rows (a supplier has
--      many); the PO references one by id instead of storing free-text
--      name/email/phone copies.
--    - Apparel PO items reference the artwork by id (artwork_id) for
--      front/back previews; the legacy copied-URL columns
--      (front_image/back_image) stay only for old rows.
--  Everything here is additive + backfilled; nothing is dropped.
-- ============================================================

-- ── 1. supplier_contacts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(50),
  wechat_id   VARCHAR(100),
  is_primary  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);

-- Seed a primary contact from each supplier's own email/phone so the
-- dropdown is never empty for existing suppliers.
INSERT INTO supplier_contacts (supplier_id, name, email, phone, is_primary)
SELECT s.id, s.name, s.email, s.phone, TRUE
FROM suppliers s
WHERE s.deleted_at IS NULL
  AND (s.email IS NOT NULL OR s.phone IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM supplier_contacts sc WHERE sc.supplier_id = s.id);

-- updated_at trigger (function guaranteed by 039)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_supplier_contacts_updated_at') THEN
    CREATE TRIGGER trg_supplier_contacts_updated_at
    BEFORE UPDATE ON supplier_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── 2. purchase_orders: type, contact, communication, payment ───────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS po_type              VARCHAR(20) NOT NULL DEFAULT 'apparel'
                                                  CHECK (po_type IN ('gangsheet','apparel')),
  ADD COLUMN IF NOT EXISTS supplier_contact_id  UUID REFERENCES supplier_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS communication_method VARCHAR(10) NOT NULL DEFAULT 'email'
                                                  CHECK (communication_method IN ('email','wechat')),
  ADD COLUMN IF NOT EXISTS payment_status       VARCHAR(20) NOT NULL DEFAULT 'Unpaid'
                                                  CHECK (payment_status IN ('Unpaid','Partial','Paid'));

-- ── 3. po_orders: which orders a PO covers ───────────────────────────────────
CREATE TABLE IF NOT EXISTS po_orders (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id      UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  order_id   UUID        NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(po_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_po_orders_po    ON po_orders(po_id);
CREATE INDEX IF NOT EXISTS idx_po_orders_order ON po_orders(order_id);

-- Backfill from the legacy single-order FK
INSERT INTO po_orders (po_id, order_id)
SELECT id, order_id FROM purchase_orders
WHERE order_id IS NOT NULL
ON CONFLICT (po_id, order_id) DO NOTHING;

-- ── 4. po_gangsheet_fragments: master gangsheets built for a PO ──────────────
CREATE TABLE IF NOT EXISTS po_gangsheet_fragments (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id          UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  fragment_no    VARCHAR(50)   NOT NULL,
  order_id       UUID          REFERENCES orders(id) ON DELETE SET NULL,
  width_inches   NUMERIC(6,2),
  length_inches  NUMERIC(6,2),
  artworks_count INTEGER       NOT NULL DEFAULT 0 CHECK (artworks_count >= 0),
  qty            INTEGER       NOT NULL DEFAULT 0 CHECK (qty >= 0),
  file_url       TEXT,
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_fragments_po ON po_gangsheet_fragments(po_id);

-- ── 5. po_artworks: artworks attached to a PO ────────────────────────────────
CREATE TABLE IF NOT EXISTS po_artworks (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id      UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  artwork_id UUID        NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(po_id, artwork_id)
);
CREATE INDEX IF NOT EXISTS idx_po_artworks_po      ON po_artworks(po_id);
CREATE INDEX IF NOT EXISTS idx_po_artworks_artwork ON po_artworks(artwork_id);

-- ── 6. purchase_order_items: apparel grid fields ─────────────────────────────
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS brand              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS color              VARCHAR(80),
  ADD COLUMN IF NOT EXISTS size               VARCHAR(30),
  ADD COLUMN IF NOT EXISTS artwork_id         UUID REFERENCES artworks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artwork_size_front VARCHAR(50),
  ADD COLUMN IF NOT EXISTS artwork_size_back  VARCHAR(50);

-- Legacy single artwork_size becomes the front placement size
UPDATE purchase_order_items
SET artwork_size_front = artwork_size
WHERE artwork_size_front IS NULL AND artwork_size IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_poi_artwork
  ON purchase_order_items(artwork_id) WHERE artwork_id IS NOT NULL;
