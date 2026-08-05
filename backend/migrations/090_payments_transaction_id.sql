-- 090_payments_transaction_id.sql
-- The processor's own transaction id (PayPal, Zelle, card, etc.) is the
-- unique receipt for a real-world money movement, so an import can never
-- duplicate a payment that already exists in the table. Nullable — Zelle
-- transfers straight through a bank often have no id.
--
-- Additive schema-only. A partial unique index ignores NULLs so the many
-- Zelle rows without an id do not clash.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_uniq
  ON payments (transaction_id)
  WHERE transaction_id IS NOT NULL;
