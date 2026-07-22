-- Every Nextcloud file is a first-class Artwork Vault row. The numeric value
-- is database-generated so human-readable ART numbers stay unique under
-- concurrent syncs and uploads.
CREATE SEQUENCE IF NOT EXISTS artwork_vault_asset_number_seq START WITH 1;

ALTER TABLE artwork_vault_assets
  ADD COLUMN IF NOT EXISTS asset_number BIGINT,
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(20)
    CHECK (order_type IN ('apparel','dtf','gangsheet'));

ALTER TABLE artwork_vault_assets
  ALTER COLUMN asset_number SET DEFAULT nextval('artwork_vault_asset_number_seq');

UPDATE artwork_vault_assets
SET asset_number = nextval('artwork_vault_asset_number_seq')
WHERE asset_number IS NULL;

SELECT setval(
  'artwork_vault_asset_number_seq',
  GREATEST((SELECT COALESCE(MAX(asset_number), 0) FROM artwork_vault_assets), 1),
  true
);

ALTER TABLE artwork_vault_assets ALTER COLUMN asset_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ava_asset_number ON artwork_vault_assets(asset_number);
CREATE INDEX IF NOT EXISTS idx_ava_order_type ON artwork_vault_assets(order_type);

UPDATE artwork_vault_assets SET order_type = CASE
  WHEN path ~* 'gang[ _-]?sheets?' THEN 'gangsheet'
  WHEN path ~* '(^|[/ _-])(dtf|transfer|transfers)([/ _-]|$)' THEN 'dtf'
  WHEN path ~* 'apparel|custom[ _-]?(shirt|shirts|hoodie|hoodies)|t[ _-]?shirts?' THEN 'apparel'
  ELSE NULL
END
WHERE order_type IS NULL;

-- Prefer the lead explicitly linked to the matched customer. This guarantees
-- every file for that customer repeats the same CRM lead number.
UPDATE artwork_vault_assets a SET lead_id = c.lead_id
FROM customers c
WHERE a.customer_id = c.id AND c.lead_id IS NOT NULL
  AND a.lead_id IS DISTINCT FROM c.lead_id;
