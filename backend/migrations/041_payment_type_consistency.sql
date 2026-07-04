-- ============================================================
--  041_payment_type_consistency.sql
--
--  payment_method / payment_terms were a Postgres ENUM on some tables
--  (orders, payments on migration-path databases) and VARCHAR(50) on
--  others (quotations, invoices, purchase_orders, and the Docker-init
--  version of payments). Application-level validation (zod) is the
--  gatekeeper for allowed values; at the DB level one consistent type
--  beats two divergent ones — enum churn already forced four separate
--  "add value" migrations.
--
--  This migration converts the remaining ENUM columns to VARCHAR(50)
--  (lossless: enum label → same text) and drops the two enum types once
--  nothing references them. Status enums (order_status, invoice_status,
--  etc.) are intentionally left as enums — they are real state machines.
-- ============================================================

DO $$
BEGIN
  -- orders.payment_terms: enum → varchar (preserve default)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='orders' AND column_name='payment_terms'
               AND udt_name='payment_terms') THEN
    ALTER TABLE orders ALTER COLUMN payment_terms DROP DEFAULT;
    ALTER TABLE orders ALTER COLUMN payment_terms TYPE VARCHAR(50)
      USING payment_terms::text;
    ALTER TABLE orders ALTER COLUMN payment_terms SET DEFAULT 'Due on Receipt';
  END IF;

  -- orders.payment_method: enum → varchar
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='orders' AND column_name='payment_method'
               AND udt_name='payment_method') THEN
    ALTER TABLE orders ALTER COLUMN payment_method TYPE VARCHAR(50)
      USING payment_method::text;
  END IF;

  -- payments.payment_method: enum → varchar
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='payments' AND column_name='payment_method'
               AND udt_name='payment_method') THEN
    ALTER TABLE payments ALTER COLUMN payment_method TYPE VARCHAR(50)
      USING payment_method::text;
  END IF;
END $$;

-- Drop the now-unreferenced enum types. If anything still depends on
-- them (an unexpected schema variant), keep them and carry on.
DO $$ BEGIN
  DROP TYPE payment_method;
EXCEPTION WHEN dependent_objects_still_exist OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  DROP TYPE payment_terms;
EXCEPTION WHEN dependent_objects_still_exist OR undefined_object THEN NULL; END $$;
