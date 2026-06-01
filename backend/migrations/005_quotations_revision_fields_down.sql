-- ============================================================
--  005_quotations_revision_fields_down.sql  (rollback)
-- ============================================================

DROP INDEX IF EXISTS idx_quotations_parent;
DROP INDEX IF EXISTS idx_quotations_lead_id;

ALTER TABLE quotations
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS parent_quote_id,
  DROP COLUMN IF EXISTS revision_number,
  DROP COLUMN IF EXISTS currency;
