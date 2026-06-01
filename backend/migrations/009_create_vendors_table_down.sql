-- ============================================================
--  009_create_vendors_table_down.sql  (rollback)
-- ============================================================

DROP INDEX   IF EXISTS idx_po_vendor_id;
ALTER TABLE  purchase_orders DROP COLUMN IF EXISTS vendor_id;
DROP INDEX   IF EXISTS idx_vendors_deleted;
DROP INDEX   IF EXISTS idx_vendors_active;
DROP TABLE   IF EXISTS vendors;
