-- Custom fields configuration table
-- Allows admins to define per-entity dynamic fields without schema migrations.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cf_entity_type') THEN
    CREATE TYPE cf_entity_type AS ENUM (
      'lead', 'quotation', 'invoice', 'order', 'supplier', 'product'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cf_field_type') THEN
    CREATE TYPE cf_field_type AS ENUM (
      'text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'textarea'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS custom_fields (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type    cf_entity_type NOT NULL,
  field_key      VARCHAR(64)    NOT NULL
                   CONSTRAINT cf_field_key_slug CHECK (field_key ~ '^[a-z][a-z0-9_]*$'),
  field_label    VARCHAR(128)   NOT NULL,
  field_type     cf_field_type  NOT NULL,
  is_required    BOOLEAN        NOT NULL DEFAULT false,
  default_value  TEXT,
  options        JSONB,
  display_order  INTEGER        NOT NULL DEFAULT 0,
  is_active      BOOLEAN        NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cf_entity_key UNIQUE (entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_cf_entity_type ON custom_fields(entity_type);
CREATE INDEX IF NOT EXISTS idx_cf_active      ON custom_fields(is_active);
