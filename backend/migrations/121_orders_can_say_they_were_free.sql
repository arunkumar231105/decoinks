-- Some orders were given away: no charge for the work, sometimes not even for
-- postage. Until now nothing recorded that, so a free job and a job whose price
-- was never entered both read as total = 0 and could not be told apart.
--
-- These are destined for a separate refund/claim module — free work produces a
-- purchase order but no sale — so the flag is what will later let them be moved
-- out cleanly rather than hunted for by eye.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.is_free IS
  'The order was given free of charge. Zero total here is a decision, not a gap.';

CREATE INDEX IF NOT EXISTS idx_orders_is_free ON orders (is_free) WHERE is_free;
