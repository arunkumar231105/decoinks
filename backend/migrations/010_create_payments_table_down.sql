-- ============================================================
--  010_create_payments_table_down.sql  (rollback)
-- ============================================================

DROP INDEX  IF EXISTS idx_payments_method;
DROP INDEX  IF EXISTS idx_payments_paid_at;
DROP INDEX  IF EXISTS idx_payments_invoice;
DROP TABLE  IF EXISTS payments;
