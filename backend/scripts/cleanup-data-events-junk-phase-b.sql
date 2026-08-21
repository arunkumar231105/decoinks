-- Phase B only, for when phase A of cleanup-data-events-junk.sql has already
-- committed (integration.data_events_new exists and is populated).
--
-- Safe to run repeatedly only up to the point of the swap: once it commits,
-- integration.data_events_old exists and this script must not be run again.
-- Verify with:  SELECT to_regclass('integration.data_events_old');

BEGIN;

LOCK TABLE integration.data_events IN ACCESS EXCLUSIVE MODE;

-- Guard: refuse to swap in a table that is empty or implausibly small, which
-- would mean phase A never committed. Swapping that in would lose every event.
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM integration.data_events_new;
  IF n < 1000 THEN
    RAISE EXCEPTION
      'Refusing to swap: data_events_new holds only % rows -- phase A did not complete. Re-run phase A first.', n;
  END IF;
END $$;

-- Anything the live app wrote during phase A. Deliberately unfiltered: the
-- window is short, the row count is tiny, and keeping everything is the
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

COMMIT;
