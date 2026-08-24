-- 117_lead_numbers_stop_colliding.sql
--
-- Creating a lead fails almost every time, and has done for a while.
--
-- display_number defaults to
--     'LD-' || lpad(nextval('lead_display_number_seq')::text, 6, '0')
-- and PostgreSQL's lpad TRUNCATES when the string is longer than the width it
-- is given. lpad('34014908', 6, '0') is '340149', not '34014908'. The sequence
-- passed 999,999 long ago — it now sits above 34 million — so every hundred
-- consecutive sequence values collapse onto one display number, and
-- display_number is unique. The first insert in each block of a hundred
-- succeeds; the other ninety-nine fail on
--     duplicate key value violates unique constraint "uq_leads_display_number"
-- which the API returns as a 409 and the screen shows as "something went
-- wrong". Each failure burns a sequence value, so the shop eventually gets its
-- lead through by trying again — which is exactly what it looks like from the
-- outside: an error that comes and goes for no reason.
--
-- Two things are fixed:
--
--   1. The number is built by a function that pads short values and leaves long
--      ones alone, so it can never truncate again whatever the sequence reaches.
--
--   2. The sequence is brought back to where the data actually is. The highest
--      number in use is LD-999552 and nothing sits above it, so numbering
--      resumes at LD-999553 instead of jumping to LD-34094417.
--
-- The column keeps its default; only what the default computes changes. No
-- existing row is touched and no number already handed out is reused.

CREATE OR REPLACE FUNCTION next_lead_display_number() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v bigint := nextval('lead_display_number_seq');
BEGIN
  -- lpad truncates a value longer than the width; pad only when it is shorter.
  RETURN 'LD-' || CASE WHEN v < 1000000 THEN lpad(v::text, 6, '0') ELSE v::text END;
END;
$$;

ALTER TABLE leads ALTER COLUMN display_number SET DEFAULT next_lead_display_number();

-- Resume from just above the highest number in the data. Guarded: if anything
-- ever sits above it, the sequence is left where it is rather than reused.
DO $$
DECLARE
  highest bigint;
  seq_at  bigint;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(display_number FROM 4) AS bigint)), 0)
    INTO highest FROM leads WHERE display_number ~ '^LD-[0-9]+$';
  SELECT last_value INTO seq_at FROM lead_display_number_seq;

  IF seq_at > highest THEN
    PERFORM setval('lead_display_number_seq', highest, true);
    RAISE NOTICE 'lead_display_number_seq moved from % back to % (next lead: LD-%)',
      seq_at, highest, highest + 1;
  END IF;
END;
$$;
