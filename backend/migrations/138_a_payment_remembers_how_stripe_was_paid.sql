-- 138: how a Stripe payment was actually paid.
--
-- A payment link lets the customer choose on Stripe's page — a card, Apple Pay,
-- Google Pay, Link, a bank account. The ledger only ever said "Stripe", which
-- stays the method: the money, the fee and the payout all go through the Stripe
-- account. This column says what the customer used, e.g.
-- "Apple Pay · Visa •••• 4242 (debit)". Read from Stripe's charge; nothing else
-- about a payment depends on it, and nothing requires it to be filled.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_via VARCHAR(120);

COMMENT ON COLUMN payments.paid_via IS
  'How the customer paid inside Stripe (card brand and last 4, Apple Pay, Google Pay, Link, bank). Informational only.';
