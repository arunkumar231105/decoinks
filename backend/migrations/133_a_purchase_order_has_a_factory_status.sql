-- 133_a_purchase_order_has_a_factory_status.sql
-- Additive: where the purchase order stands in the factory's own system.
--
--   factory_status — To be Pushed, Factory Audit, Anti Review, Pushed
--
-- Written by the factory's API when that feed is connected (PATCH
-- /purchase-orders/:id/factory-status). Until a PO has one, the list reads it
-- off the PO itself: Pushed once the factory is producing or has shipped,
-- To be Pushed before that.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS factory_status VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_factory_status_check') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_factory_status_check
      CHECK (factory_status IS NULL OR factory_status IN ('To be Pushed','Factory Audit','Anti Review','Pushed')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_factory_status_check' AND NOT convalidated) THEN
    ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_factory_status_check;
  END IF;
END $$;
