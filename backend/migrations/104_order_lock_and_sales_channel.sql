-- 104_order_lock_and_sales_channel.sql
-- Additive, two independent additions.
--
-- 1. LOCKING. A reconciled sales order or purchase order can be sealed so its
--    money, items, addresses and customer stop being editable. Production is
--    not affected: status still advances (In Production → Shipped → Delivered),
--    because locking is about the record being final, not the job being over.
--    Enforced in the service layer, which is where every write already goes.
--
-- 2. SALES CHANNEL. Orders now arrive by two routes — the TSI sheets, and DIGI
--    orders pushed straight in by API. Both carry apparel, so order_type alone
--    cannot tell them apart and neither can source_system, whose values are
--    per-import strings. One plain column makes the split filterable.
--
-- Both columns are nullable with no default, so every existing row is unchanged
-- until a reviewed script fills them in.

ALTER TABLE orders           ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ;
ALTER TABLE orders           ADD COLUMN IF NOT EXISTS locked_by     UUID REFERENCES users(id);
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ;
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS locked_by     UUID REFERENCES users(id);
ALTER TABLE orders           ADD COLUMN IF NOT EXISTS sales_channel VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_sales_channel_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_sales_channel_check
      CHECK (sales_channel IS NULL OR sales_channel IN ('TSI','DIGI')) NOT VALID;
  END IF;
END $$;

-- Partial indexes: the columns are empty on most rows and both are used as
-- filters, so only the populated rows are worth indexing.
CREATE INDEX IF NOT EXISTS idx_orders_locked_at
  ON orders (locked_at) WHERE locked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_locked_at
  ON purchase_orders (locked_at) WHERE locked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_sales_channel
  ON orders (sales_channel) WHERE sales_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_locked_by
  ON orders (locked_by) WHERE locked_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_locked_by
  ON purchase_orders (locked_by) WHERE locked_by IS NOT NULL;

-- Empty at this point, so validation is a formality; guarded for a re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'orders_sales_channel_check' AND NOT convalidated) THEN
    ALTER TABLE orders VALIDATE CONSTRAINT orders_sales_channel_check;
  END IF;
END $$;
