-- Artwork Module: additive, lossless schema alignment.
-- Existing artworks/artwork_versions/artwork_vault_assets are preserved and
-- reused. No rows are deleted or overwritten by this migration.

-- 1) Extend the existing artwork master without replacing its existing id PK.
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS reference_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS number_of_artworks INTEGER CHECK (number_of_artworks IS NULL OR number_of_artworks >= 0),
  ADD COLUMN IF NOT EXISTS number_of_fronts INTEGER CHECK (number_of_fronts IS NULL OR number_of_fronts >= 0),
  ADD COLUMN IF NOT EXISTS number_of_backs INTEGER CHECK (number_of_backs IS NULL OR number_of_backs >= 0),
  ADD COLUMN IF NOT EXISTS reference_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS order_type_text VARCHAR(30),
  ADD COLUMN IF NOT EXISTS artwork_priority VARCHAR(20),
  ADD COLUMN IF NOT EXISTS current_stage VARCHAR(40) NOT NULL DEFAULT 'Received',
  ADD COLUMN IF NOT EXISTS reference_file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reference_file_path TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_artworks_lead_id ON artworks(lead_id);
CREATE INDEX IF NOT EXISTS idx_artworks_current_stage ON artworks(current_stage);

-- 2) Extend existing artwork_versions. Existing file_link/file_type values
-- remain untouched; the new fields hold the workbook-aligned metadata.
ALTER TABLE artwork_versions
  ADD COLUMN IF NOT EXISTS version_stage VARCHAR(40),
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) DEFAULT 'Nextcloud',
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS nextcloud_file_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT,
  ADD COLUMN IF NOT EXISTS file_format VARCHAR(20),
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS width_px INTEGER,
  ADD COLUMN IF NOT EXISTS height_px INTEGER,
  ADD COLUMN IF NOT EXISTS dpi INTEGER,
  ADD COLUMN IF NOT EXISTS width_in DECIMAL(8,3),
  ADD COLUMN IF NOT EXISTS height_in DECIMAL(8,3),
  ADD COLUMN IF NOT EXISTS transparent_background BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_qa_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS internal_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS customer_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS production_ready BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE artwork_versions
SET file_format = COALESCE(file_format, file_type),
    relative_path = COALESCE(relative_path, file_link)
WHERE file_format IS NULL OR relative_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_artwork_versions_artwork ON artwork_versions(artwork_id);
CREATE INDEX IF NOT EXISTS idx_artwork_versions_active ON artwork_versions(artwork_id, is_active);

-- 3) Design Studio work queue. This is separate from generic CRM tasks so
-- artwork work has an exact artwork/version relation.
CREATE TABLE IF NOT EXISTS design_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_no VARCHAR(30) NOT NULL UNIQUE,
  artwork_id UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  task_stage VARCHAR(40) NOT NULL DEFAULT 'Design',
  task_status VARCHAR(20) NOT NULL DEFAULT 'Open',
  priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
  current_artwork_version_id UUID REFERENCES artwork_versions(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT design_tasks_stage_check CHECK (task_stage IN ('Design','Internal Review','Customer Review','Revision','Completed')),
  CONSTRAINT design_tasks_status_check CHECK (task_status IN ('Open','In Progress','Blocked','Completed','Cancelled'))
);
CREATE SEQUENCE IF NOT EXISTS design_task_no_seq;
CREATE INDEX IF NOT EXISTS idx_design_tasks_artwork ON design_tasks(artwork_id);
CREATE INDEX IF NOT EXISTS idx_design_tasks_assigned ON design_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_design_tasks_status ON design_tasks(task_status);

-- 4) Mockups are separate production/design assets and point to the exact
-- artwork version shown in the mockup.
CREATE TABLE IF NOT EXISTS mockup_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artwork_id UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  artwork_version_id UUID NOT NULL REFERENCES artwork_versions(id) ON DELETE RESTRICT,
  mockup_no VARCHAR(30) NOT NULL UNIQUE,
  apparel_type VARCHAR(50),
  apparel_color VARCHAR(50),
  apparel_size VARCHAR(20),
  artwork_width_in DECIMAL(8,3),
  artwork_height_in DECIMAL(8,3),
  mockup_type VARCHAR(20) NOT NULL DEFAULT 'Single',
  file_name VARCHAR(255) NOT NULL,
  storage_provider VARCHAR(30) NOT NULL DEFAULT 'Nextcloud',
  relative_path TEXT NOT NULL,
  nextcloud_file_id VARCHAR(255),
  thumbnail_path TEXT,
  file_format VARCHAR(20),
  file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  production_ready BOOLEAN NOT NULL DEFAULT FALSE,
  customer_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT mockup_type_check CHECK (mockup_type IN ('Single','Group'))
);
CREATE INDEX IF NOT EXISTS idx_mockup_versions_artwork ON mockup_versions(artwork_id);
CREATE INDEX IF NOT EXISTS idx_mockup_versions_artwork_version ON mockup_versions(artwork_version_id);

-- 5) Master gang sheet: order/PO-level summary.
CREATE TABLE IF NOT EXISTS master_gangsheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  master_gangsheet_no VARCHAR(30) NOT NULL UNIQUE,
  sales_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Draft',
  number_of_child_gangsheets INTEGER NOT NULL DEFAULT 0 CHECK (number_of_child_gangsheets >= 0),
  total_unique_artworks INTEGER NOT NULL DEFAULT 0 CHECK (total_unique_artworks >= 0),
  total_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  file_name VARCHAR(255),
  storage_provider VARCHAR(30) DEFAULT 'Nextcloud',
  relative_path TEXT,
  nextcloud_file_id VARCHAR(255),
  width_in DECIMAL(12,3),
  length_in DECIMAL(12,3),
  utilization_pct DECIMAL(5,2) CHECK (utilization_pct IS NULL OR utilization_pct BETWEEN 0 AND 100),
  ai_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  internal_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_master_gangsheets_order ON master_gangsheets(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_master_gangsheets_po ON master_gangsheets(purchase_order_id);

-- 6) Child gang sheets: actual production files/versions.
CREATE TABLE IF NOT EXISTS child_gangsheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  master_gangsheet_id UUID NOT NULL REFERENCES master_gangsheets(id) ON DELETE CASCADE,
  child_no INTEGER NOT NULL CHECK (child_no > 0),
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
  version_type VARCHAR(40) NOT NULL DEFAULT 'Working',
  ai_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  internal_approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  file_name VARCHAR(255) NOT NULL,
  storage_provider VARCHAR(30) NOT NULL DEFAULT 'Nextcloud',
  relative_path TEXT NOT NULL,
  nextcloud_file_id VARCHAR(255),
  thumbnail_path TEXT,
  file_format VARCHAR(20),
  width_in DECIMAL(12,3) NOT NULL,
  length_in DECIMAL(12,3) NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  dpi INTEGER,
  file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  total_unique_artworks INTEGER NOT NULL DEFAULT 0 CHECK (total_unique_artworks >= 0),
  total_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  used_area_sq_in DECIMAL(12,2),
  utilization_pct DECIMAL(5,2) CHECK (utilization_pct IS NULL OR utilization_pct BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  UNIQUE (master_gangsheet_id, child_no, version_no)
);
CREATE INDEX IF NOT EXISTS idx_child_gangsheets_master ON child_gangsheets(master_gangsheet_id);

-- 7) Exact artwork quantities used on each child production sheet.
-- sales_order_item_id is intentionally not an FK because this codebase has
-- three typed sales-order item tables; purchase_order_item_id is a real FK.
CREATE TABLE IF NOT EXISTS gangsheet_artworks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_gangsheet_id UUID NOT NULL REFERENCES child_gangsheets(id) ON DELETE CASCADE,
  artwork_version_id UUID NOT NULL REFERENCES artwork_versions(id) ON DELETE RESTRICT,
  sales_order_item_id UUID,
  purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  print_width_in DECIMAL(8,3),
  print_height_in DECIMAL(8,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (child_gangsheet_id, artwork_version_id)
);
CREATE INDEX IF NOT EXISTS idx_gangsheet_artworks_child ON gangsheet_artworks(child_gangsheet_id);
CREATE INDEX IF NOT EXISTS idx_gangsheet_artworks_version ON gangsheet_artworks(artwork_version_id);
CREATE INDEX IF NOT EXISTS idx_gangsheet_artworks_po_item ON gangsheet_artworks(purchase_order_item_id);

COMMENT ON TABLE design_tasks IS 'Design Studio artwork work queue; files remain in Nextcloud.';
COMMENT ON TABLE mockup_versions IS 'Artwork mockup metadata; source files remain in Nextcloud.';
COMMENT ON TABLE master_gangsheets IS 'Order/PO-level gang sheet summary.';
COMMENT ON TABLE child_gangsheets IS 'Actual production gang sheet files and revisions.';
COMMENT ON TABLE gangsheet_artworks IS 'Artwork/version quantity detail for each child gang sheet.';
