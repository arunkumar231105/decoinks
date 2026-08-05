-- 087_invoice_paid_follows_allocations.sql
-- Make an invoice's paid total follow payment allocations, not just a direct
-- payments.invoice_id link.
--
-- After 086 a payment can be split across several orders, so a payment that
-- covers an invoice's order — but carries no invoice_id — left that invoice
-- reading as unpaid. Two records, two different truths.
--
-- recalc_invoice_paid() now counts, for one invoice:
--   * payments attached straight to it that carry no allocations
--   * allocations naming the invoice
--   * allocations naming an order that belongs to the invoice
-- A payment is therefore counted once: through its allocations when it has
-- them, through its own invoice_id when it does not.
--
-- SAFETY: nothing is recalculated at migration time. The functions only run
-- from row triggers, so existing invoice totals are left exactly as they are;
-- an invoice is only recomputed when a payment or allocation touching it
-- changes. Replacing a function does not fire it.

CREATE OR REPLACE FUNCTION recalc_invoice_paid(p_invoice UUID) RETURNS VOID AS $$
DECLARE
  v_paid NUMERIC(12,2);
BEGIN
  IF p_invoice IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amt), 0) INTO v_paid FROM (
    SELECT p.amount AS amt
      FROM payments p
     WHERE p.invoice_id = p_invoice
       AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)
    UNION ALL
    SELECT a.allocated_amount
      FROM payment_allocations a
     WHERE a.invoice_id = p_invoice
    UNION ALL
    SELECT a.allocated_amount
      FROM payment_allocations a
      JOIN invoices i ON i.id = p_invoice AND i.order_id = a.order_id
     WHERE a.invoice_id IS NULL
  ) parts;

  UPDATE invoices
     SET amount_paid = v_paid,
         balance_due = GREATEST(total - v_paid, 0)
   WHERE id = p_invoice;
END;
$$ LANGUAGE plpgsql;

-- Replaces the old body, which only ever looked at payments.invoice_id.
CREATE OR REPLACE FUNCTION sync_invoice_payment_totals() RETURNS TRIGGER AS $$
BEGIN
  -- On UPDATE the payment may have moved between invoices; settle both.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM recalc_invoice_paid(OLD.invoice_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM recalc_invoice_paid(NEW.invoice_id);
  END IF;

  -- Also settle every invoice this payment reaches through its allocations.
  PERFORM recalc_invoice_paid(inv) FROM (
    SELECT DISTINCT COALESCE(a.invoice_id, i.id) AS inv
      FROM payment_allocations a
      LEFT JOIN invoices i ON i.order_id = a.order_id
     WHERE a.payment_id = COALESCE(NEW.id, OLD.id)
  ) t WHERE inv IS NOT NULL;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- An allocation changing must settle the invoice it points at.
CREATE OR REPLACE FUNCTION sync_invoice_from_allocation() RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_invoice_paid(inv) FROM (
    SELECT COALESCE(OLD.invoice_id, (SELECT id FROM invoices WHERE order_id = OLD.order_id)) AS inv
     WHERE TG_OP IN ('UPDATE', 'DELETE')
    UNION
    SELECT COALESCE(NEW.invoice_id, (SELECT id FROM invoices WHERE order_id = NEW.order_id))
     WHERE TG_OP IN ('INSERT', 'UPDATE')
  ) t WHERE inv IS NOT NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_sync_invoice ON payment_allocations;
CREATE TRIGGER trg_allocation_sync_invoice
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_from_allocation();
