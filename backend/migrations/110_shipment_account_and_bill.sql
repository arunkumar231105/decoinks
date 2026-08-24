-- 110_shipment_account_and_bill.sql
--
-- The shipment module's three tables are already here and already match the
-- owner's specification:
--
--   shipments           43 fields, 100 live shipments
--   shipment_tracking   the specification's fifteen fields exactly — tracking
--                       number, raw and normalised carrier status, description,
--                       estimated and confirmed delivery, last event and its
--                       location, last sync, sync status and error
--   shipping_accounts   the specification's eight fields exactly
--
-- Both new tables are empty: the tracking they describe is currently kept in
-- columns on shipments itself (tracking_status, last_scan_city, delivered_date,
-- tracking_synced_at and the rest), which is why a shipment can hold only one
-- tracking number and one carrier's history.
--
-- This adds the three header fields the specification has that shipments does
-- not, and ties the account to the shipment.
--
-- WHAT THE DATA SAYS ABOUT THE SPECIFICATION
--
--  * purchase_order_id is marked required. Not one of the 100 live shipments is
--    linked to a purchase order — 92 are linked to a sales order and 8 to
--    neither. Requiring it would invalidate every shipment in the system. po_id
--    already exists and stays nullable; a shipment reaches its PO through the
--    order when it has one.
--
--  * shipped_by_type is new. Its predecessor ship_source holds free text —
--    'Decoinks Fulfillment' on 34 shipments and nothing at all on the other 66 —
--    so the fact of who shipped it is not reliably recorded today. The new
--    column carries the specification's own two values under a CHECK.
--    ship_source is left alone rather than rewritten; it should be retired once
--    the new column is filled, not silently reinterpreted.
--
--  * shipping_account_id is required only when Decoinks ships, which is exactly
--    what the CHECK below enforces: a supplier's own shipment needs no account
--    of ours, and one of ours may not claim to have used none.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS shipping_account_id     UUID REFERENCES shipping_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_bill_file_path TEXT,
  ADD COLUMN IF NOT EXISTS shipped_by_type         VARCHAR(20);

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS chk_shipments_shipped_by_type;
ALTER TABLE shipments ADD CONSTRAINT chk_shipments_shipped_by_type CHECK (
  shipped_by_type IS NULL OR shipped_by_type IN ('SUPPLIER','DECOINKS')
);

-- Our own shipment must name the account that paid for it; a supplier's must not.
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS chk_shipments_account_when_ours;
ALTER TABLE shipments ADD CONSTRAINT chk_shipments_account_when_ours CHECK (
  shipped_by_type IS DISTINCT FROM 'DECOINKS' OR shipping_account_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipments_account ON shipments(shipping_account_id)
  WHERE shipping_account_id IS NOT NULL;

-- ── The tracking table needs to be usable ───────────────────────────────────
-- One tracking number can only belong to one shipment, and a shipment should not
-- carry the same number twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_tracking_number_uniq
  ON shipment_tracking(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_shipment ON shipment_tracking(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_unsynced ON shipment_tracking(sync_status)
  WHERE sync_status IN ('PENDING','ERROR');

ALTER TABLE shipment_tracking DROP CONSTRAINT IF EXISTS chk_shipment_tracking_sync_status;
ALTER TABLE shipment_tracking ADD CONSTRAINT chk_shipment_tracking_sync_status CHECK (
  sync_status IS NULL OR sync_status IN ('PENDING','SUCCESS','ERROR')
);

-- ── Shipping accounts ───────────────────────────────────────────────────────
ALTER TABLE shipping_accounts DROP CONSTRAINT IF EXISTS chk_shipping_accounts_platform;
ALTER TABLE shipping_accounts ADD CONSTRAINT chk_shipping_accounts_platform CHECK (
  platform IN ('SHIPPO','SHIPSTATION','UPS','USPS','FEDEX','DHL','OTHER')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_accounts_name_uniq ON shipping_accounts(lower(account_name));
CREATE INDEX IF NOT EXISTS idx_shipping_accounts_active ON shipping_accounts(is_active) WHERE is_active;
