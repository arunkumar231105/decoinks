-- ============================================================
--  004_leads_pipeline_columns_down.sql  (rollback)
-- ============================================================

DROP INDEX IF EXISTS idx_leads_source;

ALTER TABLE leads
  DROP COLUMN IF EXISTS artwork_url,
  DROP COLUMN IF EXISTS product_interest;
