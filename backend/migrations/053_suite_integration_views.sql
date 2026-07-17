-- Unified, read-only projections used for safe cross-application data flow.
-- Conditional creation keeps fresh Decoinks-only bootstrap valid.
DO $refresh_views$
BEGIN
IF to_regclass('app.customers') IS NOT NULL THEN
EXECUTE $view$CREATE OR REPLACE VIEW integration.customer_directory AS
SELECT 'decoinks'::text source_app, id::text source_id, name::text, email::text, phone::text,
       company_name::text company, status::text, created_at, updated_at
  FROM public.customers WHERE deleted_at IS NULL
UNION ALL
SELECT 'technocas_crm', customer_id::text, full_name::text, email::text, phone::text, company::text,
       status::text, created_at, updated_at
  FROM app.customers WHERE deleted_at IS NULL$view$;
END IF;

IF to_regclass('app.orders') IS NOT NULL AND to_regclass('blanktex.purchases') IS NOT NULL THEN
EXECUTE $view$CREATE OR REPLACE VIEW integration.order_flow AS
SELECT 'decoinks'::text source_app, id::text source_id, order_number::text,
       customer_id::text customer_id, status::text status, payment_status::text payment_status,
       total::numeric amount, currency::text currency, created_at, updated_at
  FROM public.orders WHERE deleted_at IS NULL
UNION ALL
SELECT 'technocas_crm', order_id::text, order_number::text, customer_id::text,
       order_status::text, payment_status::text, total_amount::numeric, currency::text,
       created_at, updated_at
  FROM app.orders
UNION ALL
SELECT 'blanktex', purchase_id::text, order_no::text, NULL::text,
       status::text, submission_status::text, NULL::numeric, NULL::text,
       created_at, updated_at
  FROM blanktex.purchases$view$;
END IF;

IF to_regclass('blanktex.styles') IS NOT NULL THEN
EXECUTE $view$CREATE OR REPLACE VIEW integration.product_catalog AS
SELECT 'decoinks'::text source_app, id::text source_id, sku::text item_code,
       name::text item_name, brand::text, product_type::text category, color::text, size::text,
       base_price::numeric price, is_active active, updated_at
  FROM public.products WHERE deleted_at IS NULL
UNION ALL
SELECT 'blanktex', style_id::text, style_no::text, style_name::text, NULL::text,
       garment_category::text, NULL::text, NULL::text, NULL::numeric,
       (active AND NOT discontinued), updated_at
  FROM blanktex.styles$view$;
END IF;
END $refresh_views$;

DO $$
DECLARE
  target TEXT;
  targets TEXT[] := ARRAY[
    'public.customers', 'public.leads', 'public.orders', 'public.products',
    'app.customers', 'app.leads', 'app.orders', 'app.artwork',
    'blanktex.purchases', 'blanktex.styles', 'dtf.users'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF to_regclass(target) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS suite_data_event ON %s', target);
      EXECUTE format(
        'CREATE TRIGGER suite_data_event AFTER INSERT OR UPDATE OR DELETE ON %s '
        'FOR EACH ROW EXECUTE FUNCTION integration.capture_change()', target
      );
    END IF;
  END LOOP;
END $$;
