-- 148: DIGI's orders, as the DIGI API reports them — the Supplier Order
-- Management page in Printshop (the owner, 17 Sep 2026).
--
-- One row per order pushed to DIGI (platformOid, e.g. ORD-260911213929): the
-- blank orders placed through BlankTex, and the older ones whose number sits on
-- a Printshop PO as supplier_reference. backend/scripts/sync-digi-orders.js
-- fills it every ten minutes from DIGI's read endpoints — queryOrderInfo,
-- queryOrderStatus, queryOrderDelivery, queryShipAddress — and the parcel's
-- courier state from Printshop's shipments, or Shippo for a parcel Printshop
-- has not recorded. Nothing here is typed by hand; nothing is sent to DIGI.
-- Additive: a new table only.

CREATE TABLE IF NOT EXISTS digi_orders (
  order_no            VARCHAR(64) PRIMARY KEY,           -- DIGI platformOid
  digi_id             VARCHAR(40),                       -- DIGI's own order id
  order_status        SMALLINT,                          -- 1 Store Audit … 12 Shipped, 13 Closed, 15 Refunded
  status_reason       TEXT,                              -- why DIGI rejected / closed it
  line_messages       TEXT,                              -- factory messages on the order's lines
  goods_total_qty     INTEGER,
  consignee_name      VARCHAR(200),
  receiver_city       VARCHAR(120),
  receiver_province   VARCHAR(60),
  receiver_country    VARCHAR(60),
  order_time          TIMESTAMPTZ,                       -- when it was pushed to DIGI (DIGI sends UTC)
  shipping_time       TIMESTAMPTZ,
  factory_address_id  VARCHAR(40),
  factory_name        VARCHAR(200),                      -- the DIGI warehouse, "City, ST"
  courier             VARCHAR(40),
  tracking_number     VARCHAR(80),
  label_url           TEXT,
  items               JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{title, color, size, qty}] from BlankTex
  courier_status      VARCHAR(30),                       -- PRE_TRANSIT / TRANSIT / DELIVERED / FAILURE / RETURNED
  courier_status_text TEXT,
  courier_eta         DATE,
  courier_delivered   DATE,
  courier_synced_at   TIMESTAMPTZ,
  po_id               UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  po_match            VARCHAR(20),                       -- supplier_reference / blanktex / name_date_qty
  order_id            UUID REFERENCES orders(id) ON DELETE SET NULL,
  source              VARCHAR(20) NOT NULL DEFAULT 'blanktex', -- blanktex / po_reference
  api_missing         BOOLEAN NOT NULL DEFAULT FALSE,     -- DIGI did not return it on the last sync
  synced_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digi_orders_order_time ON digi_orders (order_time DESC);
CREATE INDEX IF NOT EXISTS idx_digi_orders_tracking ON digi_orders (tracking_number);
CREATE INDEX IF NOT EXISTS idx_digi_orders_po ON digi_orders (po_id);
