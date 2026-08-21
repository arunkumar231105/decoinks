-- 103_orders_stage_and_process_status.sql
-- Additive: split the single combined `orders.status` into the two the business
-- actually tracks.
--
--   order_stage    — where the document itself is: Draft, Saved, Sent
--   process_status — where the job is: Completed, Pushed, In Production,
--                    Shipped, Delivered, plus Cancelled and QC, which are in
--                    use today and would otherwise have nowhere to go.
--
-- `orders.status` is deliberately left in place and kept in sync by the service
-- layer, so every existing reader, filter, board and state-machine transition
-- keeps working while the screens move over. Nothing is dropped here.
--
-- Checks are added NOT VALID and validated separately (the 040 pattern), so the
-- migration cannot fail on a row that predates it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_stage    VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS process_status VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_stage_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_order_stage_check
      CHECK (order_stage IS NULL OR order_stage IN ('Draft','Saved','Sent')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_process_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_process_status_check
      CHECK (process_status IS NULL OR process_status IN
        ('Completed','Pushed','In Production','Shipped','Delivered','Cancelled','QC')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_order_stage
  ON orders (order_stage) WHERE order_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_process_status
  ON orders (process_status) WHERE process_status IS NOT NULL;

-- Both columns are empty at this point, so validation is a formality; it is
-- guarded so a re-run on already-valid constraints is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_stage_check' AND NOT convalidated) THEN
    ALTER TABLE orders VALIDATE CONSTRAINT orders_order_stage_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_process_status_check' AND NOT convalidated) THEN
    ALTER TABLE orders VALIDATE CONSTRAINT orders_process_status_check;
  END IF;
END $$;
