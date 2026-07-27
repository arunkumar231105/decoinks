-- 074_shipment_tracking_fields.sql
-- Structured tracking columns for shipments, aligned with the Shippo tracking
-- API (https://docs.goshippo.com/docs/tracking) so live tracking data has a
-- home: to-address parts, service level, carrier status, last scan location,
-- ETA and delivery date. All nullable — populated when Shippo is wired in.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS customer_name       VARCHAR(200),  -- Shippo address_to.name
  ADD COLUMN IF NOT EXISTS service_type        VARCHAR(80),   -- Shippo servicelevel.name
  ADD COLUMN IF NOT EXISTS ship_to_city        VARCHAR(100),  -- Shippo address_to.city
  ADD COLUMN IF NOT EXISTS ship_to_state       VARCHAR(100),  -- Shippo address_to.state
  ADD COLUMN IF NOT EXISTS ship_to_postal_code VARCHAR(20),   -- Shippo address_to.zip
  ADD COLUMN IF NOT EXISTS tracking_status     VARCHAR(60),   -- Shippo tracking_status.status (e.g. TRANSIT, DELIVERED)
  ADD COLUMN IF NOT EXISTS last_scan_city      VARCHAR(100),  -- Shippo tracking_status.location.city
  ADD COLUMN IF NOT EXISTS last_scan_state     VARCHAR(100),  -- Shippo tracking_status.location.state
  ADD COLUMN IF NOT EXISTS delivered_date      DATE;          -- date the DELIVERED scan was recorded

CREATE INDEX IF NOT EXISTS idx_shipments_tracking_status ON shipments (tracking_status);
