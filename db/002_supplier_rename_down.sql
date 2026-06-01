-- ============================================================
--  002_supplier_rename_down.sql  –  ROLLBACK
--  Reverses all changes made by 002_supplier_rename.sql
--  WARNING: DROP COLUMN is irreversible — back up data first!
-- ============================================================

BEGIN;

-- 7. Drop new tables
DROP TABLE IF EXISTS portal_status_updates;
DROP TABLE IF EXISTS po_status_history;
DROP TABLE IF EXISTS po_attachments;

-- 6. Revert purchase_order_items
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS created_at;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS sort_order;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS remarks;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS required_by_date;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS tax_amt;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS tax_pct;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS discount_amt;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS uom;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS hsn_code;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS description;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS product_id;
ALTER TABLE purchase_order_items RENAME COLUMN line_total  TO amount;
ALTER TABLE purchase_order_items RENAME COLUMN unit_price  TO unit_cost;
ALTER TABLE purchase_order_items RENAME COLUMN qty_ordered TO qty;
ALTER TABLE purchase_order_items RENAME COLUMN item_name   TO description;

-- 5. Revert purchase_orders
DROP INDEX IF EXISTS idx_po_supplier;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS order_id;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS grand_total;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS other_charges;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS freight_charges;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS total_tax;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS total_discount;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS cancelled_reason;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS approved_at;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS approved_by;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS terms_conditions;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS billing_address;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS shipping_address;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS shipping_method;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS priority;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS department;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS buyer_id;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS exchange_rate;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS currency;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS payment_terms;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS supplier_reference;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS supplier_id;

-- 4. Revert activity_logs data
UPDATE activity_logs SET entity_type = 'customer' WHERE entity_type = 'supplier';

-- 3. Revert portal tables
ALTER INDEX IF EXISTS idx_portal_notif_supplier    RENAME TO idx_portal_notif_customer;
ALTER TABLE portal_notifications RENAME COLUMN supplier_id TO customer_id;

ALTER INDEX IF EXISTS idx_portal_po_vis_supplier   RENAME TO idx_portal_po_vis_customer;
ALTER TABLE portal_po_visibility RENAME COLUMN supplier_id TO customer_id;

ALTER INDEX IF EXISTS idx_portal_vis_supplier      RENAME TO idx_portal_vis_customer;
ALTER TABLE portal_order_visibility RENAME COLUMN supplier_id TO customer_id;

ALTER INDEX IF EXISTS idx_supplier_portal_users_username RENAME TO idx_portal_users_username;
ALTER INDEX IF EXISTS idx_portal_users_supplier    RENAME TO idx_portal_users_customer;
ALTER TABLE supplier_portal_users RENAME COLUMN supplier_id TO customer_id;
ALTER TABLE supplier_portal_users RENAME TO customer_portal_users;

-- 2. Revert FK column renames
ALTER TABLE artworks   RENAME COLUMN supplier_id TO customer_id;
ALTER TABLE shipments  RENAME COLUMN supplier_id TO customer_id;
ALTER TABLE invoices   RENAME COLUMN supplier_id TO customer_id;
ALTER INDEX IF EXISTS idx_orders_supplier RENAME TO idx_orders_customer;
ALTER TABLE orders     RENAME COLUMN supplier_id TO customer_id;
ALTER TABLE quotations RENAME COLUMN supplier_id TO customer_id;
ALTER INDEX IF EXISTS idx_leads_supplier RENAME TO idx_leads_customer;
ALTER TABLE leads RENAME COLUMN supplier_name TO customer_name;
ALTER TABLE leads RENAME COLUMN supplier_id   TO customer_id;

-- 1. Revert customers table
ALTER INDEX IF EXISTS idx_suppliers_status RENAME TO idx_customers_status;
ALTER INDEX IF EXISTS idx_suppliers_email  RENAME TO idx_customers_email;
ALTER TABLE suppliers RENAME TO customers;
ALTER TYPE supplier_status RENAME TO customer_status;

COMMIT;
