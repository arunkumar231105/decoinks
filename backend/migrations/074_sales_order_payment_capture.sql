-- 074_sales_order_payment_capture.sql
-- Capture "payment received" directly on the sales order form.
--
-- Business context: DecoInks orders are effectively prepaid — the customer
-- pays (Zelle / CashApp / PayPal / bank transfer …) at the time the order is
-- placed. Until now that money could only be recorded on the linked invoice
-- via a separate screen. These columns let the order form record the amount
-- received; the orders service then mirrors it into the invoice `payments`
-- ledger (the single source of truth the dashboard reads from), so the
-- dashboard "Payment Received" card and the invoice balance stay in sync.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150),
  ADD COLUMN IF NOT EXISTS payment_date      DATE;

-- Backfill amount_paid on existing orders from their linked invoice so the
-- order form shows the correct received amount when editing legacy orders.
UPDATE orders o
SET amount_paid = COALESCE(i.amount_paid, 0)
FROM invoices i
WHERE o.invoice_id = i.id
  AND o.amount_paid = 0
  AND COALESCE(i.amount_paid, 0) > 0;
