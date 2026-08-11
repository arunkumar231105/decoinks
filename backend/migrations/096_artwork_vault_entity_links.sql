-- Explicit, nullable links from a Nextcloud asset to the normalized artwork
-- model. Existing vault rows remain valid and are not guessed or rewritten.
ALTER TABLE artwork_vault_assets
  ADD COLUMN IF NOT EXISTS artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artwork_version_id UUID REFERENCES artwork_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ava_artwork_id ON artwork_vault_assets(artwork_id);
CREATE INDEX IF NOT EXISTS idx_ava_artwork_version_id ON artwork_vault_assets(artwork_version_id);

COMMENT ON COLUMN artwork_vault_assets.artwork_id IS 'Explicit normalized artwork link; nullable until reviewed.';
COMMENT ON COLUMN artwork_vault_assets.artwork_version_id IS 'Explicit exact artwork version link; nullable until reviewed.';
