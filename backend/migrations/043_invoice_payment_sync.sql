-- ============================================================
--  043_invoice_payment_sync.sql
--
--  invoices.amount_paid / balance_due are denormalised copies of
--  SUM(payments.amount). The service layer already treats the payments
--  table as the source of truth when recording a payment, but nothing
--  kept the invoice in sync when a payment row was updated or deleted.
--  This trigger recomputes both columns on every payments change, so
--  the pair can never drift from the ledger again.
--
--  Status transitions stay in the service layer on purpose — only the
--  arithmetic is enforced here.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_invoice_payment_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_paid NUMERIC(12,2);
BEGIN
  -- On UPDATE the payment may have been moved to a different invoice;
  -- recompute the old invoice as well.
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM payments WHERE invoice_id = OLD.invoice_id;

    UPDATE invoices
    SET amount_paid = v_paid,
        balance_due = GREATEST(total - v_paid, 0)
    WHERE id = OLD.invoice_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments
  WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  UPDATE invoices
  SET amount_paid = v_paid,
      balance_due = GREATEST(total - v_paid, 0)
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN NULL;  -- AFTER trigger, return value ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_sync_invoice ON payments;
CREATE TRIGGER trg_payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION sync_invoice_payment_totals();
