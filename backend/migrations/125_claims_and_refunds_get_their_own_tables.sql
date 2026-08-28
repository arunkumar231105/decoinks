-- The claims module: what a customer says went wrong, what they want done, and
-- what the shop decided.
--
-- Six tables, not one. A claim carries the request; the lines it affects, the
-- photographs proving it, the reviews, the status trail and the internal chatter
-- each grow at their own rate and belong in their own place.
--
-- Nothing here copies a customer's name, an order number or an invoice total.
-- Those are read through the keys, so a claim can never drift out of step with
-- the record it is about.

CREATE TABLE IF NOT EXISTS claims (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number         VARCHAR(30) NOT NULL UNIQUE,
  customer_id          UUID REFERENCES customers(id) ON DELETE RESTRICT,
  order_id             UUID REFERENCES orders(id)    ON DELETE RESTRICT,
  invoice_id           UUID REFERENCES invoices(id)  ON DELETE SET NULL,

  claim_category       VARCHAR(80),
  sub_issue            VARCHAR(80),
  quantity_affected    NUMERIC(12,2),
  claimed_amount       NUMERIC(14,2),
  reported_via         VARCHAR(40),
  description          TEXT,

  -- A customer can ask for more than one remedy at once — part refunded, part
  -- replaced — so this is a list, not a single choice.
  preferred_resolution TEXT[] NOT NULL DEFAULT '{}',
  requested_amount     NUMERIC(14,2),
  urgency_by_date      DATE,
  customer_comments    TEXT,

  -- The decision as it stands. The full history of how it got here lives in
  -- claim_reviews; these columns are the current answer.
  review_notes         TEXT,
  decision             VARCHAR(30) NOT NULL DEFAULT 'Pending',
  resolution_type      VARCHAR(40),
  approved_amount      NUMERIC(14,2),
  responsible_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_date        TIMESTAMPTZ,

  status               VARCHAR(30) NOT NULL DEFAULT 'Draft',
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT claims_status_check CHECK (status IN
    ('Draft','Raised','Under Review','Approved','Refunded','Closed','Rejected')),
  CONSTRAINT claims_decision_check CHECK (decision IN
    ('Pending','Approve','Reject','Need More Info'))
);

-- A claim names the lines it is about: 250 of the 500 shirts, or only the DTF
-- half of the job. The line lives in one of three tables depending on what was
-- printed, so the table is named alongside the id rather than inventing a
-- fourth product table to point at.
CREATE TABLE IF NOT EXISTS claim_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  order_item_table  VARCHAR(30),
  order_item_id     UUID,
  invoice_item_id   UUID,
  quantity_affected NUMERIC(12,2),
  reason            TEXT,
  claimed_amount    NUMERIC(14,2),
  approved_amount   NUMERIC(14,2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT claim_items_table_check CHECK (order_item_table IS NULL OR order_item_table IN
    ('order_items_apparel','order_items_dtf','order_items_gangsheet'))
);

CREATE TABLE IF NOT EXISTS claim_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  file_name   VARCHAR(255) NOT NULL,
  file_url    TEXT NOT NULL,
  file_type   VARCHAR(30),
  mime_type   VARCHAR(120),
  file_size   BIGINT,
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The timeline on the right of the form. Never derived from claims.status —
-- that only ever knows where a claim is now, not when it got there or who moved it.
CREATE TABLE IF NOT EXISTS claim_status_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  status     VARCHAR(30) NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes      TEXT
);

-- Separate from the claim so a decision can be revisited: refused for more
-- information, then approved, with both readable afterwards.
CREATE TABLE IF NOT EXISTS claim_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  reviewer_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  decision        VARCHAR(30) NOT NULL,
  review_notes    TEXT,
  resolution_type VARCHAR(40),
  approved_amount NUMERIC(14,2),
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT claim_reviews_decision_check CHECK (decision IN
    ('Approve','Reject','Need More Info'))
);

CREATE TABLE IF NOT EXISTS claim_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  comment    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_customer  ON claims (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_order     ON claims (order_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_invoice   ON claims (invoice_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_status    ON claims (status)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claim_items_claim       ON claim_items (claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_attachments_claim ON claim_attachments (claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_history_claim     ON claim_status_history (claim_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_claim_reviews_claim     ON claim_reviews (claim_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_claim_comments_claim    ON claim_comments (claim_id, created_at);
