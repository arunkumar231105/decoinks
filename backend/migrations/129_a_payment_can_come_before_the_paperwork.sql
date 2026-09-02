-- Money sometimes arrives before the paperwork does.
--
-- The shop's habit is to take payment first and write the quotation and invoice
-- afterwards. Until now a payment link could only exist for an invoice, so that
-- order of events had nowhere to live: staff had to invent an invoice before
-- they could ask for money, then correct it later.
--
-- A link may now stand on its own — a customer, an amount, and a note about
-- what it is for. The invoice, when it is eventually written, claims the
-- payment that already happened. The link itself never changes.
--
-- `payments.invoice_id` was already nullable and 79 rows already use it, so a
-- payment with no invoice is not a new idea here; only the *link* was
-- over-constrained.

ALTER TABLE payment_links ALTER COLUMN invoice_id DROP NOT NULL;

-- A link with no invoice has no invoice to be described by, so it carries its
-- own description. This is what the customer reads on the pay page, and what
-- staff recognise it by in a list of payments taken in advance.
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS description TEXT;

-- The amount is still one figure and still decided by the server, but staff
-- enter it as goods plus shipping and would like to see that split again later.
-- `amount` remains the authority; these two are the record of how it was
-- reached.
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS item_amount     NUMERIC(12,2);
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(12,2);

-- A standalone link must know whose payment it is. Without an invoice there is
-- nothing else to identify the payer by, so the customer is required exactly
-- when the invoice is absent.
ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_has_a_subject;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_has_a_subject
  CHECK (invoice_id IS NOT NULL OR customer_id IS NOT NULL);

-- `uq_payment_links_one_active_per_invoice` is unaffected: Postgres treats NULLs
-- as distinct in a unique index, so any number of standalone links may be live
-- at once while an invoice still gets exactly one.

CREATE INDEX IF NOT EXISTS idx_payment_links_standalone
  ON payment_links (customer_id, status) WHERE invoice_id IS NULL;

COMMENT ON COLUMN payment_links.description IS
  'What a standalone payment is for. Shown to the customer on the pay page in place of an invoice number.';
COMMENT ON CONSTRAINT payment_links_has_a_subject ON payment_links IS
  'Every link is for an invoice or for a named customer. A link for neither could take money nobody could account for.';
