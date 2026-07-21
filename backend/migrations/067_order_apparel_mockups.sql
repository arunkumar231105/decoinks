-- Optional front/back mockup images on apparel order items. Uploaded from
-- the order form; the sales-order print shows the mockup columns only when
-- at least one item actually has a mockup.
ALTER TABLE order_items_apparel
  ADD COLUMN IF NOT EXISTS front_mockup TEXT,
  ADD COLUMN IF NOT EXISTS back_mockup  TEXT;
