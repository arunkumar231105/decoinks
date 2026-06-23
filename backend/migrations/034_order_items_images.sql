ALTER TABLE order_items_gangsheet
  ADD COLUMN IF NOT EXISTS back_image TEXT;

ALTER TABLE order_items_dtf
  ADD COLUMN IF NOT EXISTS front_image TEXT,
  ADD COLUMN IF NOT EXISTS back_image  TEXT;
