-- An invoice has one payment link, and every screen must be able to show it.
--
-- Migration 127 stored only the SHA-256 of the token, on the reasoning that a
-- copy of the table should not be a bag of working links. That was right about
-- the risk and wrong about the shape of the job: with only a hash, the URL
-- cannot be rebuilt, so the Customer Portal's Pay Now had to mint a *new* link
-- — which voided the one the agent had already sent over WhatsApp. A customer
-- who opened the portal killed the link in their own inbox.
--
-- So the token is kept, but encrypted rather than in the clear. A database dump
-- on its own is still not a bag of working links: opening one needs the key,
-- which lives in `settings` and never appears in a backup of this table.
-- `token_hash` stays exactly as it was and remains the lookup key, so
-- verification is unchanged and no existing row is invalidated.

ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS token_encrypted TEXT;

COMMENT ON COLUMN payment_links.token_encrypted IS
  'AES-256-GCM of the URL token, keyed by settings.paylink_encryption_key. Lets the admin and the portal show the same link instead of issuing competing ones. Null on links created before this column existed — those can only be regenerated.';

-- Links minted before this migration have no recoverable token. Rather than
-- letting a screen offer a Copy button that cannot produce a URL, mark them so
-- the application knows to regenerate instead.
COMMENT ON TABLE payment_links IS
  'One invoice, one fixed amount, payable once. token_hash verifies; token_encrypted lets the same link be shown again.';
