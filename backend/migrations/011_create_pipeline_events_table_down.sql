-- ============================================================
--  011_create_pipeline_events_table_down.sql  (rollback)
-- ============================================================

DROP INDEX  IF EXISTS idx_pipeline_events_target;
DROP INDEX  IF EXISTS idx_pipeline_events_type;
DROP INDEX  IF EXISTS idx_pipeline_events_source;
DROP TABLE  IF EXISTS pipeline_events;
