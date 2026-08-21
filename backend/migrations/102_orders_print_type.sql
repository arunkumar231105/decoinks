-- 102_orders_print_type.sql
-- Additive: record on the sales order which print process it is for, so a DTF
-- transfer order can be told apart from a customer apparel order without
-- inferring it from order_type. purchase_orders already carries print_type;
-- this brings the sales order in line with it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_type VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_orders_print_type
  ON orders (print_type)
  WHERE print_type IS NOT NULL;
