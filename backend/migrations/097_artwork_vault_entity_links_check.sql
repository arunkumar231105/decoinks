-- Prevent linking a version from one artwork to a different artwork.
CREATE OR REPLACE FUNCTION validate_artwork_vault_version_link()
RETURNS trigger AS $$
BEGIN
  IF NEW.artwork_version_id IS NOT NULL AND NEW.artwork_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM artwork_versions v
       WHERE v.id = NEW.artwork_version_id AND v.artwork_id = NEW.artwork_id
     ) THEN
    RAISE EXCEPTION 'Artwork version % does not belong to artwork %', NEW.artwork_version_id, NEW.artwork_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_artwork_vault_version_link ON artwork_vault_assets;
CREATE TRIGGER trg_validate_artwork_vault_version_link
  BEFORE INSERT OR UPDATE OF artwork_id, artwork_version_id ON artwork_vault_assets
  FOR EACH ROW EXECUTE FUNCTION validate_artwork_vault_version_link();
