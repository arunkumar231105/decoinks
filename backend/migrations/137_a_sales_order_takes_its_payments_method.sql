-- 137: a sales order's payment method is the one on the payment that pays it.
--
-- The reconciliation of 15 Sep 2026 found 115 of 152 paid sales orders naming a
-- different method from their own payment: the order form stored codes
-- ('zelle', 'other') and offered no Shopify, Cash App, Venmo or Apple Pay, so
-- those orders read "other", and a method typed on the order was never checked
-- against the money. The owner's rule: the payment ledger is right and the
-- sales order follows it. Kept here, in the database, so every path that writes
-- either side — the two forms, imports, scripts — keeps them equal.

-- The method that speaks for an order: the payment holding order_id first, then
-- a payment reaching it through an allocation; the earliest when there are two.
CREATE OR REPLACE FUNCTION public.order_payment_method_of(p_order UUID)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT method FROM (
    SELECT p.payment_method AS method, 0 AS via, p.payment_date, p.created_at
      FROM public.payments p
     WHERE p.order_id = p_order
    UNION ALL
    SELECT p.payment_method, 1, p.payment_date, p.created_at
      FROM public.payment_allocations a
      JOIN public.payments p ON p.id = a.payment_id
     WHERE a.order_id = p_order
  ) linked
  WHERE NULLIF(BTRIM(method), '') IS NOT NULL
  ORDER BY via, payment_date NULLS LAST, created_at
  LIMIT 1
$$;

-- An order with a payment cannot be given another method: whatever is written,
-- the payment's stands. An order with no payment yet keeps what it is given.
CREATE OR REPLACE FUNCTION public.orders_follow_payment_method()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_method TEXT;
BEGIN
  v_method := public.order_payment_method_of(NEW.id);
  IF v_method IS NOT NULL AND NEW.payment_method IS DISTINCT FROM v_method THEN
    NEW.payment_method := v_method;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_follow_payment_method ON public.orders;
CREATE TRIGGER trg_orders_follow_payment_method
  BEFORE INSERT OR UPDATE OF payment_method ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_follow_payment_method();

-- Bring one order into line with its payments (nothing to do when it has none).
CREATE OR REPLACE FUNCTION public.sync_order_payment_method(p_order UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_method TEXT;
BEGIN
  IF p_order IS NULL THEN RETURN; END IF;
  v_method := public.order_payment_method_of(p_order);
  IF v_method IS NOT NULL THEN
    UPDATE public.orders SET payment_method = v_method
     WHERE id = p_order AND payment_method IS DISTINCT FROM v_method;
  END IF;
END;
$$;

-- A payment attached to an order, moved to another, or given a new method
-- carries the method to every order it pays.
CREATE OR REPLACE FUNCTION public.payments_carry_method_to_orders()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.sync_order_payment_method(OLD.order_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sync_order_payment_method(NEW.order_id);
    PERFORM public.sync_order_payment_method(a.order_id)
       FROM public.payment_allocations a WHERE a.payment_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_carry_method_to_orders ON public.payments;
CREATE TRIGGER trg_payments_carry_method_to_orders
  AFTER INSERT OR DELETE OR UPDATE OF payment_method, order_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_carry_method_to_orders();

CREATE OR REPLACE FUNCTION public.allocations_carry_method_to_orders()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.sync_order_payment_method(OLD.order_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sync_order_payment_method(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocations_carry_method_to_orders ON public.payment_allocations;
CREATE TRIGGER trg_allocations_carry_method_to_orders
  AFTER INSERT OR DELETE OR UPDATE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.allocations_carry_method_to_orders();
