-- Normalize each Nextcloud file into an artwork family and lifecycle role.
-- The source file remains untouched in Nextcloud; these are searchable index
-- fields used by the Artwork Vault UI.
ALTER TABLE artwork_vault_assets
  ADD COLUMN IF NOT EXISTS artwork_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS lifecycle_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS naming_convention_valid BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE artwork_vault_assets DROP CONSTRAINT IF EXISTS artwork_vault_assets_lifecycle_code_check;
ALTER TABLE artwork_vault_assets ADD CONSTRAINT artwork_vault_assets_lifecycle_code_check
  CHECK (lifecycle_code IS NULL OR lifecycle_code IN ('SRC','WRK','MOCK','OUT','FNL'));

ALTER TABLE artwork_vault_assets DROP CONSTRAINT IF EXISTS artwork_vault_assets_asset_type_check;
UPDATE artwork_vault_assets SET asset_type = 'artwork' WHERE asset_type = 'version';
ALTER TABLE artwork_vault_assets ADD CONSTRAINT artwork_vault_assets_asset_type_check
  CHECK (asset_type IN ('reference','artwork','mockup','gangsheet','sent'));

-- Documents stay in Nextcloud but do not belong in the visual Artwork Vault.
DELETE FROM artwork_vault_assets
WHERE path ~* '(^|/)(documents?|invoices?|quotes?)(/|$)';

UPDATE artwork_vault_assets SET
  artwork_code = UPPER(substring(file_name FROM '(?i)(AW-[A-Z0-9]+-[0-9]{4})-(?:SRC|WRK|MOCK|OUT|FNL)')),
  lifecycle_code = COALESCE(
    UPPER(substring(file_name FROM '(?i)AW-[A-Z0-9]+-[0-9]{4}-(SRC|WRK|MOCK|OUT|FNL)')),
    CASE
      WHEN path ~* '(^|/)(references?|refs?)(/|$)' THEN 'SRC'
      WHEN path ~* '(^|/)(artworks?|working)(/|$)' THEN 'WRK'
      WHEN path ~* '(^|/)(mockups?)(/|$)' THEN 'MOCK'
      WHEN path ~* '(^|/)(sent|outgoing)(/|$)' THEN 'OUT'
      WHEN path ~* '(^|/)(gangsheets?|finals?|production)(/|$)' THEN 'FNL'
      ELSE 'WRK'
    END
  ),
  naming_convention_valid = file_name ~* 'AW-[A-Z0-9]+-[0-9]{4}-(SRC|WRK|MOCK|OUT|FNL)',
  version_no = COALESCE(
    NULLIF(substring(file_name FROM '(?i)(?:[-_ ]V(?:ERSION)?[-_ ]?)([0-9]+)')::INTEGER, 0),
    version_no,
    1
  );

UPDATE artwork_vault_assets SET
  asset_type = CASE lifecycle_code
    WHEN 'SRC' THEN 'reference'
    WHEN 'WRK' THEN 'artwork'
    WHEN 'MOCK' THEN 'mockup'
    WHEN 'OUT' THEN 'sent'
    WHEN 'FNL' THEN 'gangsheet'
    ELSE 'artwork'
  END,
  status = CASE lifecycle_code
    WHEN 'SRC' THEN 'Source Received'
    WHEN 'WRK' THEN 'In Design'
    WHEN 'MOCK' THEN 'Mockup Ready'
    WHEN 'OUT' THEN 'Sent to Customer'
    WHEN 'FNL' THEN 'Production Ready'
    ELSE status
  END,
  production_ready = (lifecycle_code = 'FNL');

CREATE INDEX IF NOT EXISTS idx_ava_artwork_code ON artwork_vault_assets(artwork_code);
CREATE INDEX IF NOT EXISTS idx_ava_lifecycle_code ON artwork_vault_assets(lifecycle_code);
