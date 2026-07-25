-- Design Studio round-trip revisions. The live asset keeps its stable UUID and
-- path; every save first snapshots the bytes/metadata that it replaces.
ALTER TABLE artwork_vault_assets DROP CONSTRAINT IF EXISTS artwork_vault_assets_version_no_check;
ALTER TABLE artwork_vault_assets ALTER COLUMN version_no SET DEFAULT 0;
UPDATE artwork_vault_assets SET version_no = 0 WHERE version_no = 1;
ALTER TABLE artwork_vault_assets ADD CONSTRAINT artwork_vault_assets_version_no_check
  CHECK (version_no >= 0);

CREATE TABLE IF NOT EXISTS artwork_vault_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES artwork_vault_assets(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL CHECK (version_no >= 0),
  storage_path TEXT NOT NULL,
  file_name VARCHAR(300) NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  etag VARCHAR(255),
  saved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source_app VARCHAR(40) NOT NULL DEFAULT 'design-studio',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_ava_revision_asset
  ON artwork_vault_revisions(asset_id, version_no DESC);
