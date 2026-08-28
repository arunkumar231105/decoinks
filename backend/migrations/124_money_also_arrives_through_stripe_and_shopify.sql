-- Money reaches the shop through Stripe and through Shopify, but the account
-- type check listed neither, so neither could be recorded as a destination and
-- those deposits had nowhere honest to sit.
--
-- Widening a CHECK, not replacing it: every type that was allowed still is.
ALTER TABLE payment_accounts DROP CONSTRAINT IF EXISTS payment_accounts_account_type_check;
ALTER TABLE payment_accounts ADD CONSTRAINT payment_accounts_account_type_check
  CHECK (account_type IN ('bank', 'paypal', 'zelle', 'cashapp', 'card', 'stripe', 'shopify', 'other'));

INSERT INTO payment_accounts (account_name, account_type, account_title, identifier, currency, is_active, is_default)
SELECT v.name, v.type, 'Decoinks LLC', v.ident, 'USD', TRUE, FALSE
FROM (VALUES
  ('Stripe — Decoinks',  'stripe',  'info@decoinks.com'),
  ('Shopify — Decoinks', 'shopify', 'info@decoinks.com')
) AS v(name, type, ident)
WHERE NOT EXISTS (SELECT 1 FROM payment_accounts a WHERE a.account_name = v.name);
