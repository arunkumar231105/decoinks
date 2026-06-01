-- ============================================================
--  011_create_pipeline_events_table.sql
--  Structured event log for pipeline auto-triggers.
--  Records every state transition and the records it created.
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_events (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type   VARCHAR(80)  NOT NULL,
  source_table VARCHAR(50)  NOT NULL,
  source_id    UUID         NOT NULL,
  target_table VARCHAR(50),
  target_id    UUID,
  triggered_by UUID         REFERENCES users(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata     JSONB
);

COMMENT ON COLUMN pipeline_events.event_type IS
  'e.g. quote_approved, invoice_partially_paid, invoice_paid, order_created, po_sent';
COMMENT ON COLUMN pipeline_events.source_table IS
  'Table that changed: quotations, invoices, orders, purchase_orders';
COMMENT ON COLUMN pipeline_events.target_table IS
  'Table that was auto-created as a result, if any';

CREATE INDEX IF NOT EXISTS idx_pipeline_events_source
  ON pipeline_events(source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_type
  ON pipeline_events(event_type, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_target
  ON pipeline_events(target_table, target_id)
  WHERE target_table IS NOT NULL;
