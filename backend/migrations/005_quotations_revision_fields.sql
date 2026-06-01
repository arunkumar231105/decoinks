-- ============================================================
--  005_quotations_revision_fields.sql
--  Adds: currency, revision_number, parent_quote_id,
--        sent_at, approved_at, index on lead_id
-- ============================================================

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS currency         VARCHAR(3)   NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS revision_number  INTEGER      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_quote_id  UUID
        REFERENCES quotations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotations_lead_id
  ON quotations(lead_id);

CREATE INDEX IF NOT EXISTS idx_quotations_parent
  ON quotations(parent_quote_id) WHERE parent_quote_id IS NOT NULL;
