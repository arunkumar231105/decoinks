-- 079_shipment_label_fields.sql
-- Store the outcome of buying a shipping label through Shippo:
-- the printable label PDF URL, the Shippo transaction id (needed to refund /
-- void an unused label), the chosen rate id, and a small status flag.
-- Additive + idempotent; all nullable. Tracking number / carrier / service /
-- cost reuse the existing columns.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS label_url             TEXT,          -- printable label (PDF) from Shippo
  ADD COLUMN IF NOT EXISTS label_status          VARCHAR(30),   -- PURCHASED | REFUND_REQUESTED | REFUNDED
  ADD COLUMN IF NOT EXISTS shippo_transaction_id VARCHAR(100),  -- Shippo transaction id (for refund/void)
  ADD COLUMN IF NOT EXISTS shippo_rate_id        VARCHAR(100);  -- Shippo rate id the label was bought from
