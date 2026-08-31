-- A payment link is a promise made in advance: this invoice, this customer,
-- this exact amount, payable once.
--
-- The amount is written down here at the moment the link is created and is
-- never read from the customer's browser afterwards, because the browser is
-- the one thing in this transaction that the customer can edit. Whatever the
-- shop entered is what Stripe is asked to charge.
--
-- The secret in the URL is not stored. Only its SHA-256 is, so a copy of this
-- table is not a bag of working payment links. Verification hashes what
-- arrives and looks for a match, the same shape as a password check.
--
-- Nothing here duplicates the money. `payments` remains the ledger and the
-- invoice trigger remains the arithmetic; a link records only that a link
-- existed, what it was for, and which ledger row eventually answered it.

CREATE TABLE IF NOT EXISTS payment_links (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHA-256 hex of the token that travels in the URL. The token itself is
  -- shown to staff once, at creation, and is not recoverable from here.
  token_hash               CHAR(64) NOT NULL,

  invoice_id               UUID NOT NULL REFERENCES invoices(id)  ON DELETE RESTRICT,
  order_id                 UUID          REFERENCES orders(id)    ON DELETE SET NULL,
  customer_id              UUID          REFERENCES customers(id) ON DELETE RESTRICT,

  -- Fixed at creation. The pay page renders this and Stripe is charged this.
  amount                   NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency                 VARCHAR(3)    NOT NULL DEFAULT 'USD',

  status                   VARCHAR(20)   NOT NULL DEFAULT 'active',

  -- A link that never expires is a link that still works after the job, the
  -- season and the price are gone. NULL is allowed for the rare deliberate
  -- case; the application sets a date by default.
  expires_at               TIMESTAMPTZ,

  -- Stripe's side of the story, kept so a support question can be answered
  -- without hunting through the dashboard.
  stripe_payment_intent_id VARCHAR(64),

  -- The ledger row this link produced, once it produced one.
  payment_id               UUID REFERENCES payments(id) ON DELETE SET NULL,

  sent_at                  TIMESTAMPTZ,
  first_opened_at          TIMESTAMPTZ,
  paid_at                  TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,

  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payment_links_status_check
    CHECK (status IN ('active', 'paid', 'expired', 'void'))
);

-- The token is the credential, so a collision must be impossible rather than
-- unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_token
  ON payment_links (token_hash);

-- One live link per invoice. Re-issuing voids the previous one instead of
-- leaving two URLs in the world that both claim to collect the same money.
-- Partial, so paid, expired and voided links accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_one_active_per_invoice
  ON payment_links (invoice_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_payment_links_invoice  ON payment_links (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_customer ON payment_links (customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status   ON payment_links (status);

COMMENT ON TABLE payment_links IS
  'One invoice, one fixed amount, payable once. The URL secret is stored only as a SHA-256.';
COMMENT ON COLUMN payment_links.amount IS
  'Set by the shop at creation. Never read from the request when charging.';


-- Stripe tells us the money landed by calling us, and it will call more than
-- once: retries on our slow responses, and duplicates when its own delivery is
-- uncertain. Booking the same charge twice would be a real accounting error,
-- so every event id we have already handled is written down here and a repeat
-- becomes a no-op.
--
-- This is the second of two defences. The first is `payments.transaction_id`,
-- already uniquely indexed, which stops a duplicate even if this table were
-- somehow bypassed.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     VARCHAR(64) PRIMARY KEY,
  type         VARCHAR(80) NOT NULL,
  payload      JSONB,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL means received but not yet successfully handled; `error` says why.
  processed_at TIMESTAMPTZ,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_unprocessed
  ON stripe_events (received_at) WHERE processed_at IS NULL;

COMMENT ON TABLE stripe_events IS
  'Every Stripe webhook event id we have seen, so a redelivery cannot double-book a payment.';


-- A returning customer should be recognised by Stripe rather than re-entered,
-- so their saved methods and receipts stay on one Stripe record instead of
-- scattering across a new one per invoice.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_stripe_customer
  ON customers (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
