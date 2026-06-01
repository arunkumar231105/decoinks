-- ============================================================
--  013_refresh_tokens.sql
--  Proper refresh-token store for silent-refresh flow.
--  Access tokens: short-lived JWT (15 min).
--  Refresh tokens: opaque random bytes, hashed in DB (7 days).
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,  -- SHA-256 hex of the raw token
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked_at  TIMESTAMPTZ,                   -- NULL = active
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rt_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash     ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_expires  ON refresh_tokens(expires_at);
