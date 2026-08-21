-- 105_rate_precision_four_decimals.sql
-- Widen the per-unit RATE columns from numeric(12,2) to numeric(12,4).
--
-- A rate typed as 2.037 was being stored as 2.04: the column had room for two
-- decimals and Postgres rounded on the way in, so re-opening the quotation
-- always showed the rounded figure back. This is the rate the shop quotes per
-- transfer, and it is genuinely finer than a cent.
--
-- Only the RATE columns move. The line `amount` stays numeric(12,2) on purpose:
-- what the customer is billed is a whole number of cents, so 5 x 2.037 is
-- $10.19, not $10.185. Order, invoice and quotation totals are sums of those
-- amounts and are unaffected.
--
-- Widening the scale is lossless -- every stored value keeps its meaning, 2.04
-- simply becomes 2.0400 -- so no data is rewritten and nothing needs backfilling.
--
-- Postgres will not retype a column a view depends on. Three shipping-schema
-- views sit on these columns: v_order_dtf_items and v_order_apparel_items read
-- unit_price directly, and v_order_shipping_summary reads both of those. They
-- are dropped innermost-last and recreated in dependency order below, verbatim
-- from the definitions live in the database at the time this was written, so
-- their shape is unchanged.
--
-- Idempotent: each ALTER is guarded on the column's current scale and the views
-- are recreated unconditionally, so re-running is a no-op.

DROP VIEW IF EXISTS shipping.v_order_shipping_summary;
DROP VIEW IF EXISTS shipping.v_order_dtf_items;
DROP VIEW IF EXISTS shipping.v_order_apparel_items;

DO $$
DECLARE
  t text;
  c text;
  targets CONSTANT text[][] := ARRAY[
    ['quotation_items',       'unit_price'],
    ['invoice_items',         'unit_price'],
    ['order_items_dtf',       'unit_price'],
    ['order_items_apparel',   'unit_price'],
    ['order_items_gangsheet', 'price_per_sheet'],
    ['purchase_order_items',  'unit_price']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    t := targets[i][1];
    c := targets[i][2];
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = c
         AND data_type = 'numeric' AND numeric_scale < 4
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(12,4)', t, c);
      RAISE NOTICE 'widened %.% to numeric(12,4)', t, c;
    END IF;
  END LOOP;
END $$;

CREATE VIEW shipping.v_order_dtf_items AS
SELECT t.id AS line_id,
    t.order_id,
    t.artwork_name,
    t.size AS size_label,
    d.width_in,
    d.length_in,
    t.qty AS quantity,
    round(COALESCE(d.length_in, 0::numeric) * t.qty::numeric, 2) AS printed_inches,
    t.unit_price,
    t.amount,
    t.sort_order
   FROM order_items_dtf t
     LEFT JOIN LATERAL shipping.parse_sheet_dims(t.size::text) d(width_in, length_in) ON true;

CREATE VIEW shipping.v_order_apparel_items AS
SELECT ap.id AS line_id,
    ap.order_id,
    ap.item,
    COALESCE(ap.category, ap.item) AS category,
    ap.brand,
    ap.color,
    ap.size,
    ap.qty AS quantity,
    ap.unit_price,
    ap.amount,
    ap.product_image,
    ap.sort_order
   FROM order_items_apparel ap;

CREATE VIEW shipping.v_order_shipping_summary AS
SELECT so.order_id,
    so.order_number,
    so.order_type,
    so.status,
    so.order_date,
    so.entry_date,
    so.need_by_date,
    so.order_value,
    so.currency,
    so.shipping_charges,
    so.customer_id,
    so.customer_name,
    so.shipping_name,
    so.contact_name,
    so.contact_email,
    so.contact_phone,
    so.ship_to_line,
    so.ship_to_city,
    so.ship_to_state,
    so.ship_to_postal_code,
    so.ship_to_country,
    so.ship_to_line1,
    so.ship_to_line2,
    so.shipping_method,
    so.courier,
    so.tracking_number,
    so.production_facility,
    so.production_priority,
    so.shipped_at,
    so.created_at,
    so.updated_at,
    COALESCE(gs.sheet_count, 0) AS gangsheet_count,
    COALESCE(gs.printed_inches, 0::numeric) AS gangsheet_printed_inches,
    COALESCE(dt.transfer_count, 0) AS dtf_transfer_count,
    COALESCE(dt.printed_inches, 0::numeric) AS dtf_printed_inches,
    COALESCE(ap.unit_count, 0) AS apparel_unit_count,
    COALESCE(ap.line_count, 0) AS apparel_line_count
   FROM shipping.v_sales_orders so
     LEFT JOIN LATERAL ( SELECT sum(g.quantity)::integer AS sheet_count,
            sum(g.printed_inches) AS printed_inches
           FROM shipping.v_order_gangsheets g
          WHERE g.order_id = so.order_id) gs ON true
     LEFT JOIN LATERAL ( SELECT sum(t.quantity)::integer AS transfer_count,
            sum(t.printed_inches) AS printed_inches
           FROM shipping.v_order_dtf_items t
          WHERE t.order_id = so.order_id) dt ON true
     LEFT JOIN LATERAL ( SELECT sum(a.quantity)::integer AS unit_count,
            count(*)::integer AS line_count
           FROM shipping.v_order_apparel_items a
          WHERE a.order_id = so.order_id) ap ON true;
