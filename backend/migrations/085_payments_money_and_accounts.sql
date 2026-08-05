-- 085_payments_money_and_accounts.sql
-- Give payments a real money breakdown and record both sides of the transfer.
--
-- 1. payment_accounts — the company's own receiving accounts. Decoinks receives money
--    into several places (bank, PayPal, Zelle, …) and needs to know which one a
--    payment landed in, so these are a lookup table rather than free text:
--    reporting can then group by account, and a renamed account updates once.
--
-- 2. payments gains:
--      item_amount / shipping_amount  — the split the owner asked for, with
--                                       amount kept as the authoritative total
--      received_from_name             — who actually sent it, which is often
--                                       not the customer on the order
--      received_into_account_id       — which company account it landed in
--      sender_*                       — the payer's bank/account, free text
--                                       because it varies per payer
--
-- The split is enforced: amount = item_amount + shipping_amount. The table is
-- empty, so this is safe to add now. If partial payments are ever recorded the
-- constraint chk_payments_amount_split is the single line to drop.
--
-- Only the sender's last four digits are stored. Keeping a payer's full account
-- number would be sensitive data this system has no need to hold.
--
-- Additive + idempotent + schema-only.

CREATE TABLE IF NOT EXISTS payment_accounts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_name   VARCHAR(120) NOT NULL,              -- shown in the dropdown
  account_type   VARCHAR(20)  NOT NULL DEFAULT 'bank'
                 CHECK (account_type IN ('bank','paypal','zelle','cashapp','card','other')),
  bank_name      VARCHAR(120),                       -- Bank of America
  account_title  VARCHAR(120),                       -- Decoinks LLC
  account_number VARCHAR(60),                        -- our own account, we may hold in full
  routing_number VARCHAR(40),                        -- ACH / wire
  identifier     VARCHAR(160),                       -- PayPal/Zelle email or handle
  currency       CHAR(3)      NOT NULL DEFAULT 'USD',
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  is_default     BOOLEAN      NOT NULL DEFAULT FALSE,
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_accounts_name ON payment_accounts (lower(account_name));
CREATE INDEX IF NOT EXISTS idx_payment_accounts_active ON payment_accounts (is_active) WHERE is_active;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS item_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_from_name       VARCHAR(160),
  ADD COLUMN IF NOT EXISTS received_into_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_bank_name         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sender_account_name      VARCHAR(160),
  ADD COLUMN IF NOT EXISTS sender_account_last4     VARCHAR(4),
  ADD COLUMN IF NOT EXISTS sender_reference         VARCHAR(120);

-- Components must be non-negative and add up to the total.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_amount_split;
ALTER TABLE payments ADD  CONSTRAINT chk_payments_amount_split
  CHECK (item_amount >= 0 AND shipping_amount >= 0
         AND amount = item_amount + shipping_amount);

-- Last four digits only, and only digits.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_sender_last4;
ALTER TABLE payments ADD  CONSTRAINT chk_payments_sender_last4
  CHECK (sender_account_last4 IS NULL OR sender_account_last4 ~ '^[0-9]{1,4}$');

CREATE INDEX IF NOT EXISTS idx_payments_into_account ON payments (received_into_account_id);
