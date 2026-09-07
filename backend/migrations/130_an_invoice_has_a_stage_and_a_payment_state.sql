-- An invoice was saying two things in one word.
--
-- `status` held Draft, Sent, Paid, Overdue, Void and Partially Paid — a mix of
-- where the document has got to and where the money has got to. Reading the
-- list you could not tell whether "Sent" meant the customer had it and had not
-- paid, or that it had been sent and paid and nobody updated it.
--
-- The two are separated the way orders already separate them (order_stage next
-- to process_status): `status` keeps the money — it is what twenty call sites
-- across the dashboard, the customer KPIs, the Stripe pay links, the portal and
-- the webhooks already read, and none of them change — and the document's own
-- progress moves here.
--
-- Additive: every existing row keeps the status it had, and nothing reads this
-- column until the code that fills it ships.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_stage VARCHAR(20);

-- Draft is written, Saved is finished but not yet with the customer, Sent has
-- gone out. Nothing else is a stage: Paid and Overdue describe money.
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_stage;
ALTER TABLE invoices
  ADD CONSTRAINT chk_invoices_stage
  CHECK (invoice_stage IS NULL OR invoice_stage IN ('Draft', 'Saved', 'Sent'));

-- The lists sort and filter on it, and every row will carry one.
CREATE INDEX IF NOT EXISTS idx_invoices_stage ON invoices (invoice_stage);
