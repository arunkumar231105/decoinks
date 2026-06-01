-- ============================================================
--  017_po_tracking.sql
--  Adds tracking fields to purchase_orders so suppliers can
--  submit shipment tracking info via the portal.
-- ============================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS carrier         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tracking_notes  TEXT;
