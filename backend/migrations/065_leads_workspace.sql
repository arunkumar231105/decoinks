-- Production Leads workspace fields and compact human-readable numbering.
-- The existing lead_number remains the immutable source/external identifier.

CREATE SEQUENCE IF NOT EXISTS lead_display_number_seq;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS display_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS auto_responded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

-- Stable backfill by original creation order. No business data is invented.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS seq
  FROM leads
  WHERE display_number IS NULL
)
UPDATE leads l
SET display_number = 'LD-' || LPAD(numbered.seq::TEXT, 6, '0')
FROM numbered
WHERE l.id = numbered.id;

SELECT setval(
  'lead_display_number_seq',
  GREATEST(
    COALESCE((
      SELECT MAX(SUBSTRING(display_number FROM 4)::BIGINT)
      FROM leads
      WHERE display_number ~ '^LD-[0-9]{6,}$'
    ), 0),
    1
  ),
  EXISTS (SELECT 1 FROM leads WHERE display_number IS NOT NULL)
);

ALTER TABLE leads
  ALTER COLUMN display_number SET DEFAULT
    ('LD-' || LPAD(nextval('lead_display_number_seq')::TEXT, 6, '0')),
  ALTER COLUMN display_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_display_number
  ON leads(display_number);
CREATE INDEX IF NOT EXISTS idx_leads_created_active
  ON leads(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_score_active
  ON leads(conversion_score DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_estimated_value_active
  ON leads(estimated_value DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_followup_active
  ON leads(next_followup_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_auto_responded_active
  ON leads(auto_responded) WHERE deleted_at IS NULL;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS chk_leads_conversion_score,
  ADD CONSTRAINT chk_leads_conversion_score
    CHECK (conversion_score IS NULL OR conversion_score BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS chk_leads_estimated_value,
  ADD CONSTRAINT chk_leads_estimated_value
    CHECK (estimated_value IS NULL OR estimated_value >= 0);

COMMENT ON COLUMN leads.display_number IS
  'Compact internal human-readable lead number; lead_number remains the external/source identifier.';
