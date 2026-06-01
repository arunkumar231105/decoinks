-- ============================================================
--  020_lead_quote_intake.sql
--  Schema foundation for Lead → Quotation auto-population.
--  Idempotent: all DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- ── H) lead_status enum additions ────────────────────────────────────────────
--  Note: run.js wraps each file in BEGIN/COMMIT; ALTER TYPE ADD VALUE is
--  permitted inside transactions on PostgreSQL 12+.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'Quotation Generated';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'Quotation Sent';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'Quotation Approved';

-- ── A) leads — contact fields ─────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS email        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS phone        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS whatsapp     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS wechat       VARCHAR(100);

-- ── B) leads — address fields ─────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS country          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS zip              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS billing_address  TEXT;

-- ── C) leads — classification + AI-assist fields ──────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS buyer_type        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conversion_score  SMALLINT,
  ADD COLUMN IF NOT EXISTS estimated_value   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS urgency           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS repeat_buyer      BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_date     DATE,
  ADD COLUMN IF NOT EXISTS internal_notes    TEXT;

-- ── D) leads — CRM comms snapshot fields ──────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_message          TEXT,
  ADD COLUMN IF NOT EXISTS communication_channel VARCHAR(50),
  ADD COLUMN IF NOT EXISTS message_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_intent       TEXT,
  ADD COLUMN IF NOT EXISTS pending_questions     TEXT;

-- ── E) lead_product_interest child table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_product_interest (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id       UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_type  VARCHAR(100),
  qty           INTEGER,
  sizes         TEXT,
  colors        TEXT,
  artwork_count INTEGER      NOT NULL DEFAULT 0,
  notes         TEXT,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lpi_lead ON lead_product_interest(lead_id);

-- ── F) quotations — fields to receive lead data ───────────────────────────────
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS company_name                  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS customer_name                 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS billing_email                 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contact_number                VARCHAR(50),
  ADD COLUMN IF NOT EXISTS whatsapp                      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS wechat                        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_category             VARCHAR(50),
  ADD COLUMN IF NOT EXISTS customer_source               VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shipping_country              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_state                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_city                 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS zip_code                      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS shipping_address              TEXT,
  ADD COLUMN IF NOT EXISTS billing_address               TEXT,
  ADD COLUMN IF NOT EXISTS due_date                      DATE,
  ADD COLUMN IF NOT EXISTS sales_agent_id                UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS internal_notes                TEXT,
  ADD COLUMN IF NOT EXISTS customer_requirement_summary  TEXT,
  ADD COLUMN IF NOT EXISTS quote_estimate                NUMERIC(12,2);

-- ── G) quotation_items — product grid fields ──────────────────────────────────
ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS sizes         TEXT,
  ADD COLUMN IF NOT EXISTS colors        TEXT,
  ADD COLUMN IF NOT EXISTS artwork_count INTEGER NOT NULL DEFAULT 0;
