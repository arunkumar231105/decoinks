-- ============================================================
--  030_fix_refresh_tokens.sql
--  Ensures refresh_tokens table exists with all required columns.
--
--  Problem: ensure-baseline.js incorrectly listed 013_refresh_tokens.sql
--  in DOCKER_INIT_MIGRATIONS, causing run.js to skip it on Docker-init
--  databases (where db/init.sql ran but does NOT create refresh_tokens).
--  Servers set up before the refresh-token system was added may also have
--  an older version of the table missing revoked_at / ip_address columns.
-- ============================================================

-- Create the table if it was never created (Docker-init baseline bug)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Add any columns that may be missing on older table versions
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address  VARCHAR(45);
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent  TEXT;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_rt_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash    ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_expires ON refresh_tokens(expires_at);
