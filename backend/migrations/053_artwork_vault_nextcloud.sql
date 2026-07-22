-- Nextcloud-backed Artwork Vault index. Source files remain in Nextcloud; this
-- table stores searchable metadata and stable UI choices such as cover images.
CREATE TABLE IF NOT EXISTS artwork_vault_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(20) NOT NULL DEFAULT 'nextcloud' CHECK (source IN ('nextcloud','local')),
  source_key VARCHAR(500) NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL DEFAULT '',
  file_name VARCHAR(300) NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  etag VARCHAR(255),
  nextcloud_file_id VARCHAR(100),
  asset_type VARCHAR(20) NOT NULL DEFAULT 'artwork'
    CHECK (asset_type IN ('reference','artwork','version','mockup','gangsheet')),
  status VARCHAR(30) NOT NULL DEFAULT 'In Design',
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  qa_approved BOOLEAN NOT NULL DEFAULT FALSE,
  production_ready BOOLEAN NOT NULL DEFAULT FALSE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  sales_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
  designer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name VARCHAR(160),
  source_modified_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_key)
);

CREATE INDEX IF NOT EXISTS idx_ava_type ON artwork_vault_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_ava_status ON artwork_vault_assets(status);
CREATE INDEX IF NOT EXISTS idx_ava_parent ON artwork_vault_assets(parent_path);
CREATE INDEX IF NOT EXISTS idx_ava_modified ON artwork_vault_assets(source_modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_ava_lead ON artwork_vault_assets(lead_id);
CREATE INDEX IF NOT EXISTS idx_ava_customer ON artwork_vault_assets(customer_id);

-- Only one explicit cover may exist in a logical folder. Folders without one
-- use a deterministic filename/oldest-file fallback in the API.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ava_folder_cover
  ON artwork_vault_assets(source, parent_path) WHERE is_cover;
