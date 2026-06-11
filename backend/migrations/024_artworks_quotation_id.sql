ALTER TABLE artworks ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artworks_quotation ON artworks(quotation_id);
