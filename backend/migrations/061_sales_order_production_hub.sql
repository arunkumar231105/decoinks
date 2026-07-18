ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS production_notes TEXT,
  ADD COLUMN IF NOT EXISTS packing_instructions TEXT,
  ADD COLUMN IF NOT EXISTS shipping_instructions TEXT,
  ADD COLUMN IF NOT EXISTS shipping_method VARCHAR(100),
  ADD COLUMN IF NOT EXISTS courier VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(150),
  ADD COLUMN IF NOT EXISTS required_ship_date DATE,
  ADD COLUMN IF NOT EXISTS production_priority VARCHAR(20) DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS production_method VARCHAR(100),
  ADD COLUMN IF NOT EXISTS production_facility VARCHAR(150),
  ADD COLUMN IF NOT EXISTS assigned_team VARCHAR(150),
  ADD COLUMN IF NOT EXISTS estimated_production_time VARCHAR(100),
  ADD COLUMN IF NOT EXISTS total_print_locations INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_items_apparel ADD COLUMN IF NOT EXISTS production_status VARCHAR(50) NOT NULL DEFAULT 'Artwork Approved';
ALTER TABLE order_items_dtf ADD COLUMN IF NOT EXISTS production_status VARCHAR(50) NOT NULL DEFAULT 'Artwork Approved';
ALTER TABLE order_items_gangsheet ADD COLUMN IF NOT EXISTS production_status VARCHAR(50) NOT NULL DEFAULT 'Artwork Approved';
