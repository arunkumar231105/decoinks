ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS artwork_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS front_image   TEXT,
  ADD COLUMN IF NOT EXISTS back_image    TEXT;
