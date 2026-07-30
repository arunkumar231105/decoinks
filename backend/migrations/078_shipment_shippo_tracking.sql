-- 078_shipment_shippo_tracking.sql
-- Extend `shipments` with the remaining Shippo Tracking API fields so live
-- tracking data (https://docs.goshippo.com/docs/tracking) has a full home:
-- sub-status + friendly text, the original ETA (for on-time / delayed math),
-- the origin (from) address, the full scan-by-scan history, carrier messages,
-- and the timestamp of the last successful Shippo sync.
--
-- Additive + idempotent only. All columns nullable — populated on demand when a
-- shipment's tracking is refreshed from Shippo. No data is mutated. The PO link
-- (po_id) already exists from 075; the PO number is surfaced via JOIN, so no new
-- column is needed for it.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS substatus                VARCHAR(80),   -- Shippo tracking_status.substatus.text / code
  ADD COLUMN IF NOT EXISTS status_details           TEXT,          -- Shippo tracking_status.status_details (human-readable)
  ADD COLUMN IF NOT EXISTS original_eta             DATE,          -- Shippo original_eta (first promised delivery date)
  ADD COLUMN IF NOT EXISTS address_from_city        VARCHAR(100),  -- Shippo address_from.city
  ADD COLUMN IF NOT EXISTS address_from_state       VARCHAR(100),  -- Shippo address_from.state
  ADD COLUMN IF NOT EXISTS address_from_postal_code VARCHAR(20),   -- Shippo address_from.zip
  ADD COLUMN IF NOT EXISTS tracking_history         JSONB,         -- Shippo tracking_history[] — full scan timeline
  ADD COLUMN IF NOT EXISTS tracking_messages        JSONB,         -- Shippo messages[] — carrier warnings / errors
  ADD COLUMN IF NOT EXISTS tracking_synced_at       TIMESTAMPTZ;   -- when tracking was last pulled from Shippo
