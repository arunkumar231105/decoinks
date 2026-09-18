-- 151: where a DIGI parcel was sent from, and whose label it went on
-- (the owner, 18 Sep 2026: a factory on every order; shipped by self or factory).
--
-- DIGI names the warehouse (addressId) on only some orders. Every shipping
-- label, though, prints its sender: "SA RAHS, 12318 LOWER AZUSA RD, ARCADIA CA",
-- "PERFECT PRINT AMERICA … MIDDLESEX NJ", "HY CAN … ORLANDO FL". The sync reads
-- the label PDF once and keeps the sender here; the grid's factory falls back
-- to it. A label DIGI bought itself sits under waybill/goodFast/ — shipped by
-- the factory; any other label was bought by the shop and handed to DIGI —
-- shipped by self. Additive.

ALTER TABLE digi_orders
  ADD COLUMN IF NOT EXISTS label_from_name    VARCHAR(160),
  ADD COLUMN IF NOT EXISTS label_from_address VARCHAR(200),
  ADD COLUMN IF NOT EXISTS label_from_city    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS label_from_state   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS label_from_zip     VARCHAR(12),
  ADD COLUMN IF NOT EXISTS label_created_on   DATE,
  ADD COLUMN IF NOT EXISTS label_text         TEXT,
  ADD COLUMN IF NOT EXISTS label_parsed_url   TEXT,          -- the label the fields above were read from
  ADD COLUMN IF NOT EXISTS shipped_by         VARCHAR(10);   -- Factory / Self
