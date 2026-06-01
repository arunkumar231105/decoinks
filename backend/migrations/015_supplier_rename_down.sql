-- Reverse: suppliers → customers rename
-- NOTE: Only reverses the table/column renames; does not drop new columns.
DO $migrate$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='suppliers') THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname='supplier_status') THEN
      ALTER TYPE supplier_status RENAME TO customer_status;
    END IF;
    ALTER TABLE suppliers RENAME TO customers;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_suppliers_email')  THEN
      ALTER INDEX idx_suppliers_email  RENAME TO idx_customers_email;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_suppliers_status') THEN
      ALTER INDEX idx_suppliers_status RENAME TO idx_customers_status;
    END IF;
  END IF;
END;
$migrate$;
