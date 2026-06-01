-- ============================================================
--  018_gangsheet.sql
--  Adds gangsheet generation tracking columns to orders,
--  and physical dimensions + placement fields to artworks.
-- ============================================================

-- ── orders: gangsheet tracking ────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gangsheet_status       VARCHAR(20) DEFAULT 'none'
    CHECK (gangsheet_status IN ('none', 'pending', 'generating', 'ready', 'error')),
  ADD COLUMN IF NOT EXISTS gangsheet_generated_at TIMESTAMPTZ;

-- ── artworks: physical size + placement ──────────────────────
ALTER TABLE artworks
  ADD COLUMN IF NOT EXISTS width_inches        NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS height_inches       NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS location_on_product VARCHAR(50);
