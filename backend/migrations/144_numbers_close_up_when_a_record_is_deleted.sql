-- 144: numbers close up when a record is deleted.
--
-- The owner, 16 Sep 2026: delete a document from the middle and the numbers
-- after it move down, so a series of 152 with 131 deleted runs 1..151 — for
-- quotations, invoices, sales orders, payments, purchase orders, shipments,
-- customers and claims. Until now a deleted number only came back for the next
-- new record (utils/counter.js), leaving the list with a hole in the meantime.
--
-- Held in the database so every way of deleting keeps to it — the list's
-- Delete, bulk delete, scripts. Leads (mostly CRM-numbered) and artworks (whose
-- numbers are in Vault file names) are not renumbered.
--
-- How: the deleted row's number is parked ("D-ORD-2026-0131-4f9a", as before),
-- then the live rows of that series take 1..N in their existing order, lowest
-- first, so no two ever hold the same number. An invoice keeps its letters.
-- Where a number is also written out as text it follows: a payment's
-- reference_no naming an invoice, a purchase order's note naming its order.
-- The series' advisory lock is the one utils/counter.js takes, so a number is
-- never handed out mid-shuffle.

CREATE OR REPLACE FUNCTION public.close_number_gaps(p_table TEXT, p_column TEXT, p_pattern TEXT, p_scope TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_soft  BOOLEAN;
  v_width INTEGER;
  v_moved INTEGER := 0;
  v_new   TEXT;
  r       RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_scope));

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'deleted_at')
    INTO v_soft;
  SELECT character_maximum_length INTO v_width FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  -- A deleted row still holding a number would collide with a live row moving onto it.
  IF v_soft THEN
    EXECUTE format(
      'UPDATE public.%I SET %I = LEFT(''D-'' || %I || ''-'' || LEFT(REPLACE(id::text, ''-'', ''''), 4), %s)
        WHERE %I ~ $1 AND deleted_at IS NOT NULL',
      p_table, p_column, p_column, COALESCE(v_width, 60), p_column)
    USING p_pattern;
  END IF;

  FOR r IN EXECUTE format(
      'SELECT id, num_text, n, rn FROM (
         SELECT id, %I AS num_text,
                CAST(regexp_replace(%I, ''^.*-'', '''') AS INTEGER) AS n,
                ROW_NUMBER() OVER (ORDER BY CAST(regexp_replace(%I, ''^.*-'', '''') AS INTEGER), id) AS rn
           FROM public.%I WHERE %I ~ $1 %s) s
        WHERE n <> rn ORDER BY n',
      p_column, p_column, p_column, p_table, p_column,
      CASE WHEN v_soft THEN 'AND deleted_at IS NULL' ELSE '' END)
    USING p_pattern
  LOOP
    v_new := regexp_replace(r.num_text, '[0-9]+$', LPAD(r.rn::text, GREATEST(4, length(r.rn::text)), '0'));
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2', p_table, p_column) USING v_new, r.id;
    IF p_table = 'invoices' THEN
      UPDATE public.payments SET reference_no = v_new WHERE reference_no = r.num_text;
    END IF;
    v_moved := v_moved + 1;
  END LOOP;

  -- A PO's note naming its order is rewritten from the order itself, not by
  -- swapping text, so a chain of moves cannot leave it naming the wrong one.
  IF v_moved > 0 AND p_table = 'orders' THEN
    UPDATE public.purchase_orders p
       SET notes = regexp_replace(p.notes, 'ORD-[0-9]{4}-[0-9]{4}', o.order_number, 'g')
      FROM public.orders o
     WHERE o.id = p.order_id AND p.deleted_at IS NULL AND o.deleted_at IS NULL
       AND p.notes ~ 'ORD-[0-9]{4}-[0-9]{4}'
       AND substring(p.notes FROM 'ORD-[0-9]{4}-[0-9]{4}') IS DISTINCT FROM o.order_number;
  END IF;

  RETURN v_moved;
END;
$$;

-- Fired after a row is soft-deleted (the WHEN clause) or deleted outright.
-- TG_ARGV[0] names the number column. The series is read off the number itself:
-- ORD-2026-0131 → every ORD-2026 number; an invoice's XYZ-0131 → the whole book.
CREATE OR REPLACE FUNCTION public.numbers_close_up_after_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_col    TEXT := TG_ARGV[0];
  v_number TEXT := to_jsonb(OLD) ->> TG_ARGV[0];
  v_series TEXT;
BEGIN
  IF v_number IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'invoices' THEN
    IF v_number ~ '^[A-Z]{3}-[0-9]+$' THEN
      PERFORM public.close_number_gaps('invoices', v_col, '^[A-Z]{3}-[0-9]+$', 'INV');
    END IF;
  ELSIF v_number ~ '^[A-Z]+-[0-9]{4}-[0-9]+$' THEN
    v_series := substring(v_number FROM '^([A-Z]+-[0-9]{4})-');
    PERFORM public.close_number_gaps(TG_TABLE_NAME, v_col, '^' || v_series || '-[0-9]+$', v_series);
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('quotations', 'quote_number', true), ('invoices', 'invoice_number', true), ('orders', 'order_number', true),
      ('payments', 'payment_number', false), ('purchase_orders', 'po_number', true), ('shipments', 'shipment_number', true),
      ('customers', 'customer_number', true), ('claims', 'claim_number', true)) AS v(tbl, col, soft)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_numbers_close_up_after_delete ON public.%I', t.tbl);
    EXECUTE format('CREATE TRIGGER trg_numbers_close_up_after_delete AFTER DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.numbers_close_up_after_delete(%L)', t.tbl, t.col);
    IF t.soft THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_numbers_close_up_after_soft_delete ON public.%I', t.tbl);
      EXECUTE format('CREATE TRIGGER trg_numbers_close_up_after_soft_delete AFTER UPDATE OF deleted_at ON public.%I
                      FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
                      EXECUTE FUNCTION public.numbers_close_up_after_delete(%L)', t.tbl, t.col);
    END IF;
  END LOOP;
END $$;

-- The holes already there close now (shipments and customers had some).
SELECT public.close_number_gaps('quotations',      'quote_number',    '^Q-2026-[0-9]+$',    'Q-2026');
SELECT public.close_number_gaps('invoices',        'invoice_number',  '^[A-Z]{3}-[0-9]+$',  'INV');
SELECT public.close_number_gaps('orders',          'order_number',    '^ORD-2026-[0-9]+$',  'ORD-2026');
SELECT public.close_number_gaps('payments',        'payment_number',  '^PAY-2026-[0-9]+$',  'PAY-2026');
SELECT public.close_number_gaps('purchase_orders', 'po_number',       '^PO-2026-[0-9]+$',   'PO-2026');
SELECT public.close_number_gaps('shipments',       'shipment_number', '^SHP-2026-[0-9]+$',  'SHP-2026');
SELECT public.close_number_gaps('customers',       'customer_number', '^CUST-2026-[0-9]+$', 'CUST-2026');
SELECT public.close_number_gaps('claims',          'claim_number',    '^CLM-2026-[0-9]+$',  'CLM-2026');
