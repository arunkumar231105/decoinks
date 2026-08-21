-- One-off, human-run data cleanup for integration.data_events.
--
-- NOT a migration: this mutates data, and migrations in this repo are
-- schema-only (Constitution §6). Run manually, after migration 082 is applied
-- and after a verified backup.
--
-- What it removes: the duplicate public.leads UPDATE snapshots produced by the
-- CRM lead-sync between 2026-07-17 and 2026-07-29 (~14 GB of near-identical
-- full-row copies of ~1,300 leads -- one lead has 8,636 of them).
--
-- What it keeps:
--   * every INSERT and every DELETE event, from every table
--   * every event from every table other than public.leads
--   * for public.leads UPDATE, the most recent event per entity_id, so the
--     last known state of every lead survives
--   * everything written while this script runs (the catch-up step below)
--
-- Why a table swap instead of DELETE: 99.93% of the table is going, so DELETE
-- would leave 14 GB of dead tuples needing a VACUUM FULL (long ACCESS
-- EXCLUSIVE lock + 15 GB of temporary space). Building a fresh table and
-- swapping names reclaims the space instantly via DROP.
--
-- Why two phases: the expensive 14 GB scan runs WITHOUT a lock. Only the
-- final catch-up and rename hold ACCESS EXCLUSIVE, for well under a second.
-- Holding the lock across the full scan would block every INSERT/UPDATE on
-- leads, orders, customers and products for minutes, because their triggers
-- write into this table.
--
-- The old table is deliberately left in place as integration.data_events_old.
-- Verify first, then drop it separately (see the final commented statement).

-- ---------------------------------------------------------------------------
-- PHASE A -- no lock. Slow (full scan, several minutes), blocks nothing.
--
-- Re-runnable: a previous interrupted attempt leaves an empty or partial
-- data_events_new behind, which is scratch and safe to discard. Do NOT run
-- this while another copy is still in progress -- check first with:
--   SELECT pid, now()-query_start FROM pg_stat_activity
--    WHERE query LIKE '%data_events_new%' AND state <> 'idle';
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS integration.data_events_new;

CREATE TABLE integration.data_events_new (LIKE integration.data_events INCLUDING ALL);

INSERT INTO integration.data_events_new
SELECT * FROM integration.data_events
WHERE NOT (source_schema = 'public' AND source_table = 'leads' AND operation = 'UPDATE')
UNION ALL
SELECT DISTINCT ON (entity_id) *
FROM integration.data_events
WHERE source_schema = 'public' AND source_table = 'leads' AND operation = 'UPDATE'
ORDER BY entity_id, event_id DESC;

-- ---------------------------------------------------------------------------
-- PHASE B -- short lock. Catch up, swap, commit.
-- ---------------------------------------------------------------------------

BEGIN;

LOCK TABLE integration.data_events IN ACCESS EXCLUSIVE MODE;

-- Anything the live app wrote during phase A. Deliberately unfiltered: the
-- window is seconds, the row count is tiny, and keeping everything is the
-- conservative choice.
INSERT INTO integration.data_events_new
SELECT * FROM integration.data_events
WHERE event_id > (SELECT COALESCE(max(event_id), 0) FROM integration.data_events_new);

-- Re-point the sequence at the new table BEFORE the old one is dropped.
-- The sequence is OWNED BY the old table's column, so dropping that table
-- without this line would cascade-drop the sequence and break every future
-- insert into data_events.
ALTER SEQUENCE integration.data_events_event_id_seq
  OWNED BY integration.data_events_new.event_id;

ALTER TABLE integration.data_events     RENAME TO data_events_old;
ALTER TABLE integration.data_events_new RENAME TO data_events;

-- Index names are intentionally left alone here: renaming a table does not
-- rename its indexes, so data_events_pkey is still held by the old table and
-- the new one keeps data_events_new_pkey. Tidy it up after the old table is
-- dropped, not during the swap.

COMMIT;

-- Verify before dropping the old table:
--   SELECT count(*) FROM integration.data_events;                             -- expect ~7,611
--   SELECT count(*) FROM integration.data_events WHERE operation = 'DELETE';  -- expect 506
--   SELECT count(DISTINCT entity_id) FROM integration.data_events
--     WHERE source_table = 'leads' AND operation = 'UPDATE';                  -- expect ~1,349
--   SELECT nextval('integration.data_events_event_id_seq');                   -- must succeed
--
-- Rollback (while data_events_old still exists):
--   BEGIN;
--   ALTER SEQUENCE integration.data_events_event_id_seq OWNED BY integration.data_events_old.event_id;
--   ALTER TABLE integration.data_events     RENAME TO data_events_reverted;
--   ALTER TABLE integration.data_events_old RENAME TO data_events;
--   COMMIT;
--
-- Reclaim the 14 GB once verified:
--   DROP TABLE integration.data_events_old;
