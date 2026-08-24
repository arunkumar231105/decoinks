-- The read-only seat (decoinks_readonly) must report the same numbers the
-- software reports. Reading the base tables does not: 12 tables soft-delete,
-- so a raw count returns 170 orders where the app shows 126, and 186 invoices
-- where the app shows 118. Revenue summed off the base tables would include
-- 68 deleted invoices.
--
-- So the seat never sees the base tables. It sees `reporting`, whose views
-- apply the same filter the app applies: the row is alive, and — for line
-- items — its parent document is alive too.
--
-- Additive and idempotent: a new schema of views. No base table, no app-visible
-- object, and no data is touched.

CREATE SCHEMA IF NOT EXISTS reporting;

-- Documents and master records: hide anything soft-deleted.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers','orders','invoices','quotations','purchase_orders','leads',
    'shipments','suppliers','customer_contacts','products','vendors','parties'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP VIEW IF EXISTS reporting.%I', t);
      EXECUTE format(
        'CREATE VIEW reporting.%I AS SELECT * FROM public.%I WHERE deleted_at IS NULL', t, t);
    END IF;
  END LOOP;
END $$;

-- Line items and attachments: alive only while their parent document is alive.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('order_items_dtf','order_id','orders'),
    ('order_items_apparel','order_id','orders'),
    ('order_items_gangsheet','order_id','orders'),
    ('order_item_artworks','order_id','orders'),
    ('shipment_orders','order_id','orders'),
    ('invoice_items','invoice_id','invoices'),
    ('invoice_items_dtf','invoice_id','invoices'),
    ('invoice_items_apparel','invoice_id','invoices'),
    ('invoice_items_gangsheet','invoice_id','invoices'),
    ('invoice_item_artworks','invoice_id','invoices'),
    ('quotation_items','quotation_id','quotations'),
    ('quotation_items_dtf','quotation_id','quotations'),
    ('quotation_items_apparel','quotation_id','quotations'),
    ('quotation_items_gangsheet','quotation_id','quotations'),
    ('quotation_item_artworks','quotation_id','quotations'),
    ('purchase_order_items','po_id','purchase_orders'),
    ('po_dtf_items','purchase_order_id','purchase_orders'),
    ('po_apparel_items','purchase_order_id','purchase_orders'),
    ('po_gangsheet_lines','purchase_order_id','purchase_orders'),
    ('po_services','purchase_order_id','purchase_orders'),
    ('po_orders','po_id','purchase_orders'),
    ('customer_addresses','customer_id','customers')
  ) AS v(child, fk, parent) LOOP
    IF to_regclass('public.'||r.child) IS NOT NULL THEN
      EXECUTE format('DROP VIEW IF EXISTS reporting.%I', r.child);
      EXECUTE format(
        'CREATE VIEW reporting.%I AS SELECT c.* FROM public.%I c '
        'JOIN public.%I p ON p.id = c.%I WHERE p.deleted_at IS NULL',
        r.child, r.child, r.parent, r.fk);
    END IF;
  END LOOP;
END $$;

-- Payments hang off three optional parents; every parent that is set must be alive.
DROP VIEW IF EXISTS reporting.payments;
CREATE VIEW reporting.payments AS
SELECT p.* FROM public.payments p
WHERE (p.customer_id IS NULL OR EXISTS (
         SELECT 1 FROM public.customers c WHERE c.id = p.customer_id AND c.deleted_at IS NULL))
  AND (p.invoice_id IS NULL OR EXISTS (
         SELECT 1 FROM public.invoices i WHERE i.id = p.invoice_id AND i.deleted_at IS NULL))
  AND (p.order_id IS NULL OR EXISTS (
         SELECT 1 FROM public.orders o WHERE o.id = p.order_id AND o.deleted_at IS NULL));

DROP VIEW IF EXISTS reporting.payment_allocations;
CREATE VIEW reporting.payment_allocations AS
SELECT a.* FROM public.payment_allocations a
WHERE (a.invoice_id IS NULL OR EXISTS (
         SELECT 1 FROM public.invoices i WHERE i.id = a.invoice_id AND i.deleted_at IS NULL))
  AND (a.order_id IS NULL OR EXISTS (
         SELECT 1 FROM public.orders o WHERE o.id = a.order_id AND o.deleted_at IS NULL));

-- The seat reads `reporting` and nothing else. The earlier blanket grants on the
-- base schemas are withdrawn so a raw count is not merely discouraged but refused.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'decoinks_readonly') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM decoinks_readonly;
    REVOKE ALL ON SCHEMA public FROM decoinks_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM decoinks_readonly;

    GRANT USAGE ON SCHEMA reporting TO decoinks_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO decoinks_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO decoinks_readonly;
  END IF;
END $$;
