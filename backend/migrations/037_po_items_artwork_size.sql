ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS artwork_size TEXT;
