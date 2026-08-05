-- 089_payments_drop_split_shipments_cost.sql
-- Move the shipping-cost concept out of payments entirely.
--
-- Before: payments stored amount = item_amount + shipping_amount and a check
-- enforced the split. But shipping cost is a property of the *parcel*, not the
-- payment — mixing them here also meant a payment for two orders had to force
-- the shipping split, which never mapped cleanly.
--
-- After: shipping cost lives on shipments.shipping_cost (already there since
-- 088; the field just gets populated by a separate data step). Payments keep
-- amount / fee_amount / net_amount only.
--
-- The table is empty (0 rows verified before running), so dropping the two
-- columns costs nothing and there is no data to migrate.
--
-- Additive/subtractive schema-only. The follow-up data script backfills
-- shipments.shipping_cost from the Shippo billing sheet and the order rows.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_amount_split;
ALTER TABLE payments DROP COLUMN IF EXISTS item_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS shipping_amount;

-- The remaining money invariant: fee cannot exceed the total received. amount
-- is checked non-null by the original schema; keep the > 0 rule.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_amount_positive;
ALTER TABLE payments ADD  CONSTRAINT chk_payments_amount_positive CHECK (amount > 0);
