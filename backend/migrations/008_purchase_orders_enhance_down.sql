-- ============================================================
--  008_purchase_orders_enhance_down.sql  (rollback)
-- ============================================================

DROP TABLE IF EXISTS po_status_history;
DROP TABLE IF EXISTS po_attachments;

-- Reverse purchase_order_items: drop added columns
ALTER TABLE purchase_order_items
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS remarks,
  DROP COLUMN IF EXISTS required_by_date,
  DROP COLUMN IF EXISTS tax_amt,
  DROP COLUMN IF EXISTS tax_pct,
  DROP COLUMN IF EXISTS discount_amt,
  DROP COLUMN IF EXISTS discount_pct,
  DROP COLUMN IF EXISTS uom,
  DROP COLUMN IF EXISTS hsn_code,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS product_id;

-- Rename columns back to original names
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_order_items' AND column_name='item_name') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN item_name   TO description;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_order_items' AND column_name='qty_ordered') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN qty_ordered TO qty;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_order_items' AND column_name='unit_price') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN unit_price  TO unit_cost;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_order_items' AND column_name='line_total') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN line_total  TO amount;
  END IF;
END $$;

-- Drop added purchase_orders columns
DROP INDEX IF EXISTS idx_po_language;
DROP INDEX IF EXISTS idx_po_order_id;
DROP INDEX IF EXISTS idx_po_supplier;

ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS order_id,
  DROP COLUMN IF EXISTS grand_total,
  DROP COLUMN IF EXISTS other_charges,
  DROP COLUMN IF EXISTS freight_charges,
  DROP COLUMN IF EXISTS total_tax,
  DROP COLUMN IF EXISTS total_discount,
  DROP COLUMN IF EXISTS cancelled_reason,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS terms_conditions,
  DROP COLUMN IF EXISTS billing_address,
  DROP COLUMN IF EXISTS shipping_address,
  DROP COLUMN IF EXISTS shipping_method,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS buyer_id,
  DROP COLUMN IF EXISTS exchange_rate,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS payment_terms,
  DROP COLUMN IF EXISTS supplier_reference,
  DROP COLUMN IF EXISTS supplier_id;

-- Restore original po_status enum
CREATE TYPE po_status_old AS ENUM (
  'Draft', 'Sent', 'Received', 'Partial', 'Cancelled'
);

ALTER TABLE purchase_orders
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE purchase_orders
  ALTER COLUMN status TYPE po_status_old
  USING (
    CASE status::text
      WHEN 'Accepted'          THEN 'Sent'
      WHEN 'In Production'     THEN 'Sent'
      WHEN 'Shipped'           THEN 'Sent'
      WHEN 'Pending Approval'  THEN 'Draft'
      WHEN 'Approved'          THEN 'Sent'
      WHEN 'Partially Received'THEN 'Partial'
      WHEN 'Closed'            THEN 'Received'
      ELSE status::text
    END
  )::po_status_old;

DROP TYPE po_status;
ALTER TYPE po_status_old RENAME TO po_status;

ALTER TABLE purchase_orders
  ALTER COLUMN status SET DEFAULT 'Draft'::po_status;
