-- ============================================================
--  019_custom_field_values.sql
--  Stores the per-record values for admin-defined custom fields.
--  One row per (entityType, entityId, fieldId) — unique constraint
--  prevents duplicates; UPSERT on conflict updates the value.
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_field_values (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type  cf_entity_type NOT NULL,
  entity_id    UUID          NOT NULL,
  field_id     UUID          NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value        TEXT,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cfv UNIQUE (entity_type, entity_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values(entity_type, entity_id);
