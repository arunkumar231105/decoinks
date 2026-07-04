-- ============================================================
--  042_counters.sql
--
--  High-water-mark store for human-readable document numbers
--  (ORD-2026-0001, QT-2026-0001, JOHNSMITH-0001, ...).
--
--  The previous implementation derived the next number from
--  MAX()/COUNT() over the live table, which had two failure modes:
--    - two concurrent requests could both commit their lookup before
--      either inserted, producing a duplicate number, and
--    - deleting a row shrank COUNT(*) so the next number collided
--      with an existing one.
--  A counter row only ever moves forward, so numbers are never reused.
--  utils/counter.js seeds each scope lazily from the existing data the
--  first time it is used (inside the same advisory-locked transaction).
-- ============================================================

CREATE TABLE IF NOT EXISTS counters (
  scope      VARCHAR(80) PRIMARY KEY,   -- e.g. 'ORD-2026', 'INV:JOHNSMITH'
  last_value BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
