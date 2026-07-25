-- 076_invoice_balance_reconcile.sql
-- Reconcile outstanding invoice balances to zero.
--
-- DecoInks operates a prepaid model: an order is paid when it is placed, and
-- the invoice is raised for a settled order. Historically a batch of Draft
-- invoices was created with amount_paid = 0 / balance_due = total, leaving a
-- phantom "Balance Due" on the Invoices workspace even though nothing is
-- actually owed. This settles those stored columns so Balance Due reads $0.
--
-- Going forward, the sales-order payment capture (migration 074 + orders
-- service) records real payments into the `payments` ledger, and the
-- sync_invoice_payment_totals trigger keeps amount_paid / balance_due correct.

UPDATE invoices
SET amount_paid = total,
    balance_due = 0,
    updated_at  = NOW()
WHERE balance_due > 0
  AND status <> 'Void';
