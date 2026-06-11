-- 023_quotation_items_images.sql
-- Add artwork image columns to quotation_items (mirrors order_items tables)

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS front_image   TEXT,
  ADD COLUMN IF NOT EXISTS back_image    TEXT,
  ADD COLUMN IF NOT EXISTS artwork_image TEXT;
