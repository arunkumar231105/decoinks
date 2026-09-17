-- 149: keep everything the DIGI API returns for an order (the owner, 17 Sep 2026).
--
-- Migration 148 stored what the Supplier Order Management grid shows. This
-- keeps the rest as well, so nothing DIGI says about an order is lost:
--   - digi_orders: the recipient's full address and phone, DIGI's platform and
--     refund status, express code, pre-shipping time, status text, shop fields,
--     and the untouched reply of each read endpoint (api_info, api_status,
--     api_delivery) — any field DIGI adds later is kept too;
--   - digi_order_lines: one row per order line — DIGI's line status and factory
--     message (queryOrderStatus) with what was ordered on it (style, colour,
--     size, pieces, print position, artwork images) from the placed order;
--   - digi_warehouses: every ship-from address row DIGI lists (queryShipAddress);
--   - digi_sync_runs: one row per sync, with its counts or its error.
-- Additive only.

ALTER TABLE digi_orders
  ADD COLUMN IF NOT EXISTS receiver_phone         VARCHAR(60),
  ADD COLUMN IF NOT EXISTS receiver_address       TEXT,
  ADD COLUMN IF NOT EXISTS receiver_address2      TEXT,
  ADD COLUMN IF NOT EXISTS receiver_post_code     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS platform_order_status  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS platform_refund_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS order_state_text       VARCHAR(60),
  ADD COLUMN IF NOT EXISTS express_code           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pre_shipping_time      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_shop_code     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS platform_shop_name     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS platform_type          SMALLINT,
  ADD COLUMN IF NOT EXISTS delivery_shipping_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_info               JSONB,
  ADD COLUMN IF NOT EXISTS api_status             JSONB,
  ADD COLUMN IF NOT EXISTS api_delivery           JSONB;

CREATE TABLE IF NOT EXISTS digi_order_lines (
  line_id            VARCHAR(80) PRIMARY KEY,               -- platformOllId, e.g. ORD-260914201744001
  order_no           VARCHAR(64) NOT NULL REFERENCES digi_orders(order_no) ON DELETE CASCADE,
  line_no            INTEGER,
  goods_status       VARCHAR(30),                           -- SHIPPED / NOT_SHIPPED
  goods_status_text  VARCHAR(60),
  product_message    TEXT,                                  -- the factory's note on this line
  refund_status      VARCHAR(30),
  title              TEXT,
  style_code         VARCHAR(40),
  style_name         TEXT,
  color_code         VARCHAR(40),
  color_name         VARCHAR(80),
  size_code          VARCHAR(40),
  size_name          VARCHAR(40),
  qty                INTEGER,
  craft_type         SMALLINT,
  goods_type         SMALLINT,
  print_position     VARCHAR(40),
  images             JSONB NOT NULL DEFAULT '[]'::jsonb,
  api_status         JSONB,                                 -- DIGI's childOrderStatus entry, untouched
  placed             JSONB,                                 -- the line as it was placed, untouched
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_digi_order_lines_order ON digi_order_lines (order_no);

CREATE TABLE IF NOT EXISTS digi_warehouses (
  id          VARCHAR(40) PRIMARY KEY,                      -- DIGI's row id
  address_id  VARCHAR(40) NOT NULL,                         -- what an order's addressId points at
  alias       VARCHAR(120),
  country     VARCHAR(60),
  province    VARCHAR(60),
  city        VARCHAR(120),
  address     TEXT,
  enabled     BOOLEAN,
  api_row     JSONB,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_digi_warehouses_address ON digi_warehouses (address_id);

CREATE TABLE IF NOT EXISTS digi_sync_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  trigger      VARCHAR(20),                                 -- cron / manual
  orders       INTEGER,
  on_api       INTEGER,
  tracked      INTEGER,
  po_linked    INTEGER,
  lines        INTEGER,
  warehouses   INTEGER,
  error        TEXT
);
