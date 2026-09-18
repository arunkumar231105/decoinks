-- 152: when a DIGI parcel was delivered, to the minute (the owner, 18 Sep 2026:
-- a time under every date on Supplier Order Management). courier_delivered keeps
-- the day; this keeps the courier's delivered scan itself. Additive.

ALTER TABLE digi_orders ADD COLUMN IF NOT EXISTS courier_delivered_at TIMESTAMPTZ;
