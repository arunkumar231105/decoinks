-- Front/back mockup images on apparel PO line items, carried over from the
-- sales order items when converting an order to a PO. The PO print shows
-- the mockup columns only when at least one item has a mockup.
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS front_mockup TEXT,
  ADD COLUMN IF NOT EXISTS back_mockup  TEXT;
