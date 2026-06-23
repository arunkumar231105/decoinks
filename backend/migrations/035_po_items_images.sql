ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS front_image TEXT,
  ADD COLUMN IF NOT EXISTS back_image  TEXT;
