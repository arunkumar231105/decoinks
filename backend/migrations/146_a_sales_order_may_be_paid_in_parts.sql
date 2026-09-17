-- A sales order may be paid in parts.
--
-- Migration 122 allowed one payment per sales order, because the same money had
-- been entered twice against one order. Customers do pay one job in two or three
-- goes, though, and the owner wants those payments linked to the order and its
-- invoice together — with the parts adding up to the order's total exactly.
--
-- The app checks "exactly" when the payments are linked (POST /invoices/:id/
-- payments). What the database keeps is the part that stops double entry: the
-- payments on one order may not add up to more than that order. A single payment
-- is left as it always was, so nothing already recorded is judged by this.
DROP INDEX IF EXISTS uq_payments_one_per_order;

CREATE OR REPLACE FUNCTION payments_parts_within_order_total()
RETURNS trigger AS $$
DECLARE
  v_count INT;
  v_sum   NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_order TEXT;
BEGIN
  IF NEW.order_id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), COALESCE(sum(amount), 0) INTO v_count, v_sum
    FROM payments WHERE order_id = NEW.order_id;
  IF v_count < 2 THEN RETURN NULL; END IF;

  SELECT total, order_number INTO v_total, v_order FROM orders WHERE id = NEW.order_id;
  IF v_sum > COALESCE(v_total, 0) + 0.01 THEN
    RAISE EXCEPTION 'Payments on % add up to %, more than its total of %', v_order, v_sum, v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_parts_within_order_total ON payments;
-- Deferred to the commit, so several payments can be linked in one transaction
-- and are judged together.
CREATE CONSTRAINT TRIGGER trg_payments_parts_within_order_total
  AFTER INSERT OR UPDATE OF order_id, amount ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payments_parts_within_order_total();

COMMENT ON FUNCTION payments_parts_within_order_total() IS
  'A sales order may hold several payments; together they may not exceed its total.';
