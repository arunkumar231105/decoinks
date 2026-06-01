-- ============================================================
--  004_leads_pipeline_columns.sql
--  Adds: product_interest, artwork_url, source index
--  Safe: all additive, IF NOT EXISTS guards throughout
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS product_interest VARCHAR(200),
  ADD COLUMN IF NOT EXISTS artwork_url      TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_source
  ON leads(source) WHERE deleted_at IS NULL;
