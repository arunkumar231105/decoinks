-- ============================================================
--  046_normalized_master_layer.sql   —  NORMALIZATION PHASE 1
--
--  Introduces the ERP-style master layer requested in the schema review:
--    parties + party_roles + party_contacts + party_addresses
--    files + file_links
--    status_history
--
--  This migration is PURELY ADDITIVE and NON-DESTRUCTIVE:
--    - It creates new tables only. It does NOT drop or alter any existing
--      table or column, so all current application code keeps working
--      exactly as before (zero functionality change, zero data loss).
--    - It backfills the new tables from existing data so the normalized
--      layer is immediately populated.
--    - Every backfill is idempotent (guarded by a source_table/source_id
--      mapping + NOT EXISTS), so re-running the migration is safe.
--
--  Later phases (separate migrations, one module at a time) will point the
--  application at these tables and only THEN retire the duplicated columns.
-- ============================================================

-- ── 1. parties — one row per real-world company/person ───────────────────────
CREATE TABLE IF NOT EXISTS parties (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_code   VARCHAR(40)  UNIQUE,
  name         VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  website      VARCHAR(255),
  tax_number   VARCHAR(50),
  status       VARCHAR(20)  NOT NULL DEFAULT 'Active',
  notes        TEXT,
  -- provenance so backfill is idempotent and traceable back to the old row
  source_table VARCHAR(30),
  source_id    UUID,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT uq_parties_source UNIQUE (source_table, source_id)
);
CREATE INDEX IF NOT EXISTS idx_parties_name    ON parties(name);
CREATE INDEX IF NOT EXISTS idx_parties_status  ON parties(status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS party_roles (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id   UUID        NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  role_type  VARCHAR(30) NOT NULL
               CHECK (role_type IN ('Customer','Supplier','Vendor',
                                    'Fulfillment Partner','Manufacturer',
                                    'Distributor','Sales Agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_party_role UNIQUE (party_id, role_type)
);
CREATE INDEX IF NOT EXISTS idx_party_roles_party ON party_roles(party_id);
CREATE INDEX IF NOT EXISTS idx_party_roles_type  ON party_roles(role_type);

CREATE TABLE IF NOT EXISTS party_contacts (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id      UUID         NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  contact_name  VARCHAR(150),
  contact_type  VARCHAR(20)  NOT NULL
                  CHECK (contact_type IN ('Email','Phone','WhatsApp','WeChat',
                                          'Facebook','Instagram','Website')),
  contact_value VARCHAR(255) NOT NULL,
  is_primary    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_party_contacts_party ON party_contacts(party_id);

CREATE TABLE IF NOT EXISTS party_addresses (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id     UUID         NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  address_type VARCHAR(20)  NOT NULL DEFAULT 'Shipping'
                 CHECK (address_type IN ('Billing','Shipping','Factory','Pickup','Other')),
  line1        VARCHAR(255),
  line2        VARCHAR(255),
  city         VARCHAR(100),
  state        VARCHAR(100),
  zip          VARCHAR(20),
  country      VARCHAR(100),
  is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_party_addresses_party ON party_addresses(party_id);

-- ── 2. files + file_links — central file registry ────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name    VARCHAR(255),
  storage_path TEXT         NOT NULL,        -- the URL / object key
  file_type    VARCHAR(30),
  mime_type    VARCHAR(100),
  file_size    INTEGER,
  checksum     VARCHAR(128),
  uploaded_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_files_storage_path UNIQUE (storage_path)
);

CREATE TABLE IF NOT EXISTS file_links (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id     UUID        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,   -- lead|quotation|invoice|order|artwork|po|shipment
  entity_id   UUID        NOT NULL,
  purpose     VARCHAR(40),            -- original_artwork|thumbnail|mockup|front|back|attachment
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_file_link UNIQUE (file_id, entity_type, entity_id, purpose)
);
CREATE INDEX IF NOT EXISTS idx_file_links_entity ON file_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_file_links_file   ON file_links(file_id);

-- ── 3. status_history — unified workflow history for every module ────────────
CREATE TABLE IF NOT EXISTS status_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(40) NOT NULL,   -- quotation|invoice|order|purchase_order|shipment|artwork|lead
  entity_id   UUID        NOT NULL,
  old_status  VARCHAR(50),
  new_status  VARCHAR(50) NOT NULL,
  changed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_history_entity ON status_history(entity_type, entity_id);

-- ============================================================================
--  BACKFILL  (idempotent — safe to re-run)
-- ============================================================================

-- ── 3a. parties from suppliers / customers / vendors ─────────────────────────
INSERT INTO parties (name, company_name, website, status, notes, source_table, source_id, deleted_at)
SELECT s.name, s.company, s.website,
       CASE WHEN s.status::text = 'Inactive' THEN 'Inactive' ELSE 'Active' END,
       s.notes, 'suppliers', s.id, s.deleted_at
FROM suppliers s
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.source_table='suppliers' AND p.source_id=s.id);

INSERT INTO parties (name, company_name, website, status, notes, source_table, source_id, deleted_at)
SELECT c.name, c.company, c.website,
       CASE WHEN c.status = 'Inactive' THEN 'Inactive'
            WHEN c.status = 'Blocked'  THEN 'Blocked'
            ELSE 'Active' END,
       c.internal_notes, 'customers', c.id, c.deleted_at
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.source_table='customers' AND p.source_id=c.id);

INSERT INTO parties (name, company_name, status, notes, source_table, source_id, deleted_at)
SELECT v.name, v.name_zh,
       CASE WHEN v.is_active THEN 'Active' ELSE 'Inactive' END,
       v.notes, 'vendors', v.id, v.deleted_at
FROM vendors v
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.source_table='vendors' AND p.source_id=v.id);

-- Derive a stable party_code from the id for rows that don't have one yet
UPDATE parties
SET party_code = 'PTY-' || UPPER(LEFT(REPLACE(id::text,'-',''), 10))
WHERE party_code IS NULL;

-- ── 3b. party_roles ──────────────────────────────────────────────────────────
INSERT INTO party_roles (party_id, role_type)
SELECT p.id, 'Supplier' FROM parties p WHERE p.source_table='suppliers'
  AND NOT EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=p.id AND r.role_type='Supplier');
INSERT INTO party_roles (party_id, role_type)
SELECT p.id, 'Fulfillment Partner' FROM parties p WHERE p.source_table='suppliers'
  AND NOT EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=p.id AND r.role_type='Fulfillment Partner');
INSERT INTO party_roles (party_id, role_type)
SELECT p.id, 'Customer' FROM parties p WHERE p.source_table='customers'
  AND NOT EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=p.id AND r.role_type='Customer');
INSERT INTO party_roles (party_id, role_type)
SELECT p.id, 'Vendor' FROM parties p WHERE p.source_table='vendors'
  AND NOT EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id=p.id AND r.role_type='Vendor');

-- ── 3c. party_contacts (only non-empty values) ───────────────────────────────
-- suppliers
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Email', s.email, TRUE FROM parties p JOIN suppliers s ON s.id=p.source_id
WHERE p.source_table='suppliers' AND NULLIF(TRIM(s.email),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts c WHERE c.party_id=p.id AND c.contact_type='Email' AND c.contact_value=s.email);
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Phone', s.phone, TRUE FROM parties p JOIN suppliers s ON s.id=p.source_id
WHERE p.source_table='suppliers' AND NULLIF(TRIM(s.phone),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts c WHERE c.party_id=p.id AND c.contact_type='Phone' AND c.contact_value=s.phone);
-- customers (email/phone/whatsapp)
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Email', c.email, TRUE FROM parties p JOIN customers c ON c.id=p.source_id
WHERE p.source_table='customers' AND NULLIF(TRIM(c.email),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts x WHERE x.party_id=p.id AND x.contact_type='Email' AND x.contact_value=c.email);
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Phone', c.phone, TRUE FROM parties p JOIN customers c ON c.id=p.source_id
WHERE p.source_table='customers' AND NULLIF(TRIM(c.phone),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts x WHERE x.party_id=p.id AND x.contact_type='Phone' AND x.contact_value=c.phone);
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'WhatsApp', c.whatsapp, FALSE FROM parties p JOIN customers c ON c.id=p.source_id
WHERE p.source_table='customers' AND NULLIF(TRIM(c.whatsapp),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts x WHERE x.party_id=p.id AND x.contact_type='WhatsApp' AND x.contact_value=c.whatsapp);
-- vendors (email/phone)
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Email', v.email, TRUE FROM parties p JOIN vendors v ON v.id=p.source_id
WHERE p.source_table='vendors' AND NULLIF(TRIM(v.email),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts x WHERE x.party_id=p.id AND x.contact_type='Email' AND x.contact_value=v.email);
INSERT INTO party_contacts (party_id, contact_type, contact_value, is_primary)
SELECT p.id, 'Phone', v.phone, TRUE FROM parties p JOIN vendors v ON v.id=p.source_id
WHERE p.source_table='vendors' AND NULLIF(TRIM(v.phone),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_contacts x WHERE x.party_id=p.id AND x.contact_type='Phone' AND x.contact_value=v.phone);

-- ── 3d. party_addresses ──────────────────────────────────────────────────────
INSERT INTO party_addresses (party_id, address_type, line1, line2, city, state, zip, country, is_default)
SELECT p.id, 'Shipping', s.address_line1, s.address_line2, s.city, s.state, s.zip, s.country, TRUE
FROM parties p JOIN suppliers s ON s.id=p.source_id
WHERE p.source_table='suppliers'
  AND COALESCE(s.address_line1,s.city,s.state,s.zip) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_addresses a WHERE a.party_id=p.id AND a.address_type='Shipping');

INSERT INTO party_addresses (party_id, address_type, line1, city, state, zip, country, is_default)
SELECT p.id, 'Shipping', c.address_line1, c.city, c.state, c.zip, c.country, TRUE
FROM parties p JOIN customers c ON c.id=p.source_id
WHERE p.source_table='customers'
  AND COALESCE(c.address_line1,c.city,c.state,c.zip) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_addresses a WHERE a.party_id=p.id AND a.address_type='Shipping');

INSERT INTO party_addresses (party_id, address_type, line1, is_default)
SELECT p.id, 'Factory', v.address, TRUE
FROM parties p JOIN vendors v ON v.id=p.source_id
WHERE p.source_table='vendors' AND NULLIF(TRIM(v.address),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM party_addresses a WHERE a.party_id=p.id AND a.address_type='Factory');

-- ── 3e. files + file_links from existing scattered URLs ──────────────────────
-- artworks (main file + thumbnail)
INSERT INTO files (file_name, storage_path, file_type, uploaded_by)
SELECT a.name, a.file_url, a.file_type, a.uploaded_by FROM artworks a
WHERE NULLIF(TRIM(a.file_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.storage_path=a.file_url);
INSERT INTO file_links (file_id, entity_type, entity_id, purpose)
SELECT f.id, 'artwork', a.id, 'original_artwork' FROM artworks a JOIN files f ON f.storage_path=a.file_url
WHERE NULLIF(TRIM(a.file_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM file_links l WHERE l.file_id=f.id AND l.entity_type='artwork' AND l.entity_id=a.id AND l.purpose='original_artwork');

INSERT INTO files (file_name, storage_path, file_type, uploaded_by)
SELECT a.name || ' (thumb)', a.thumbnail_url, 'image', a.uploaded_by FROM artworks a
WHERE NULLIF(TRIM(a.thumbnail_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.storage_path=a.thumbnail_url);
INSERT INTO file_links (file_id, entity_type, entity_id, purpose)
SELECT f.id, 'artwork', a.id, 'thumbnail' FROM artworks a JOIN files f ON f.storage_path=a.thumbnail_url
WHERE NULLIF(TRIM(a.thumbnail_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM file_links l WHERE l.file_id=f.id AND l.entity_type='artwork' AND l.entity_id=a.id AND l.purpose='thumbnail');

-- po_attachments
INSERT INTO files (file_name, storage_path, file_type, mime_type, file_size, uploaded_by)
SELECT pa.filename, pa.file_url, NULL, pa.mime_type, pa.file_size, pa.uploaded_by FROM po_attachments pa
WHERE NULLIF(TRIM(pa.file_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.storage_path=pa.file_url);
INSERT INTO file_links (file_id, entity_type, entity_id, purpose)
SELECT f.id, 'po', pa.po_id, 'attachment' FROM po_attachments pa JOIN files f ON f.storage_path=pa.file_url
WHERE NULLIF(TRIM(pa.file_url),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM file_links l WHERE l.file_id=f.id AND l.entity_type='po' AND l.entity_id=pa.po_id AND l.purpose='attachment');

-- lead_attachments
INSERT INTO files (file_name, storage_path, mime_type, file_size, uploaded_by)
SELECT la.filename, la.storage_path, la.mime_type, la.size_bytes, la.uploaded_by FROM lead_attachments la
WHERE NULLIF(TRIM(la.storage_path),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.storage_path=la.storage_path);
INSERT INTO file_links (file_id, entity_type, entity_id, purpose)
SELECT f.id, 'lead', la.lead_id, 'attachment' FROM lead_attachments la JOIN files f ON f.storage_path=la.storage_path
WHERE NULLIF(TRIM(la.storage_path),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM file_links l WHERE l.file_id=f.id AND l.entity_type='lead' AND l.entity_id=la.lead_id AND l.purpose='attachment');

-- ── 3f. status_history from existing po_status_history ───────────────────────
INSERT INTO status_history (entity_type, entity_id, old_status, new_status, changed_by, changed_at, notes)
SELECT 'purchase_order', h.po_id, h.from_status, h.to_status, h.changed_by, h.created_at, h.comment
FROM po_status_history h
WHERE NOT EXISTS (
  SELECT 1 FROM status_history s
  WHERE s.entity_type='purchase_order' AND s.entity_id=h.po_id
    AND s.new_status=h.to_status AND s.changed_at=h.created_at
);

-- updated_at trigger for parties (function guaranteed by 039)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_parties_updated_at') THEN
    CREATE TRIGGER trg_parties_updated_at BEFORE UPDATE ON parties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
