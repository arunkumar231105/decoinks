-- Shared integration layer for Decoinks, Technocas CRM, BlankTex and DTF.
-- Application tables remain isolated by schema; this layer is additive only.
CREATE SCHEMA IF NOT EXISTS integration;

CREATE TABLE IF NOT EXISTS integration.applications (
  app_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  schema_name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO integration.applications (app_code, display_name, schema_name) VALUES
  ('decoinks', 'Decoinks', 'public'),
  ('technocas_crm', 'Technocas CRM', 'app'),
  ('blanktex', 'BlankTex', 'blanktex'),
  ('dtf_mockup', 'DTF Mockup Creator', 'dtf')
ON CONFLICT (app_code) DO UPDATE
SET display_name = EXCLUDED.display_name, schema_name = EXCLUDED.schema_name, active = TRUE;

CREATE TABLE IF NOT EXISTS integration.entity_links (
  link_id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  source_app TEXT NOT NULL REFERENCES integration.applications(app_code),
  source_id TEXT NOT NULL,
  target_app TEXT NOT NULL REFERENCES integration.applications(app_code),
  target_id TEXT NOT NULL,
  match_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, source_app, source_id, target_app, target_id)
);

CREATE TABLE IF NOT EXISTS integration.data_events (
  event_id BIGSERIAL PRIMARY KEY,
  source_schema TEXT NOT NULL,
  source_table TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  entity_id TEXT,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_integration_events_pending
  ON integration.data_events (event_id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION integration.capture_change() RETURNS trigger AS $$
DECLARE
  body JSONB;
BEGIN
  body := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  body := body - 'password_hash' - 'token' - 'token_hash';
  INSERT INTO integration.data_events
    (source_schema, source_table, operation, entity_id, payload)
  VALUES
    (TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
     COALESCE(body->>'id', body->>'customer_id', body->>'lead_id',
              body->>'order_id', body->>'purchase_id', body->>'style_id',
              body->>'artwork_id', body->>'user_id'), body);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Stable empty projections make a fresh Decoinks-only installation valid even
-- before the other three schemas have been imported. Migration 053 replaces
-- them with live UNION views when the module tables are available.
CREATE OR REPLACE VIEW integration.customer_directory AS
SELECT NULL::text source_app, NULL::text source_id, NULL::text name,
       NULL::text email, NULL::text phone, NULL::text company, NULL::text status,
       NULL::timestamptz created_at, NULL::timestamptz updated_at WHERE FALSE;

CREATE OR REPLACE VIEW integration.order_flow AS
SELECT NULL::text source_app, NULL::text source_id, NULL::text order_number,
       NULL::text customer_id, NULL::text status, NULL::text payment_status,
       NULL::numeric amount, NULL::text currency, NULL::timestamptz created_at,
       NULL::timestamptz updated_at WHERE FALSE;

CREATE OR REPLACE VIEW integration.product_catalog AS
SELECT NULL::text source_app, NULL::text source_id, NULL::text item_code,
       NULL::text item_name, NULL::text brand, NULL::text category,
       NULL::text color, NULL::text size, NULL::numeric price,
       NULL::boolean active, NULL::timestamptz updated_at WHERE FALSE;
