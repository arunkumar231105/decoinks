-- 154: notifications — the bell in Printshop's header and push to phones
-- (owner, 19 Sep 2026: payment received, DIGI shipped, parcel delivered, parcel
-- stuck in Pre-Transit for 3+ days, new claim).
--
--   notifications        one row per person per event, with its read state.
--                        dedupe_key makes each event land once, however often
--                        the watcher runs.
--   push_subscriptions   a browser / installed app that asked for phone
--                        notifications (Web Push); dropped when the push service
--                        says it is gone.
--   notification_state   the watcher's own bookmarks (from when it started
--                        looking), so a first run never floods old events.
-- Additive only.

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  dedupe_key  VARCHAR(200) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at     TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS notification_state (
  key         VARCHAR(60) PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
