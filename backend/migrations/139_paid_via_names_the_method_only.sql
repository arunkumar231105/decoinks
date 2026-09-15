-- 139: paid_via names the method only.
--
-- 138 wrote "Apple Pay · Visa •••• 9457 (credit)". The owner does not want any
-- card or account digits kept — the method is enough — so the values become the
-- part before " · ": "Apple Pay", "Card", "Link", "Cash App Pay", "Bank (ACH)".
-- Only paid_via changes; no amount, fee, method or link is touched.
UPDATE payments
   SET paid_via = split_part(paid_via, ' · ', 1)
 WHERE paid_via LIKE '% · %';

COMMENT ON COLUMN payments.paid_via IS
  'How the customer paid inside Stripe — the method name only (Card, Apple Pay, Google Pay, Link, Cash App Pay, Bank (ACH)). No card or account digits. Informational only.';
