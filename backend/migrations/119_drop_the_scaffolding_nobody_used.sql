-- 119_drop_the_scaffolding_nobody_used.sql
--
-- Six tables leave the schema. They were never a feature that was abandoned —
-- they are one scaffold that was never wired up, and the shape gives it away:
-- ai_chats, conversations, messages, notes, receipts and webhook_events all
-- carry the identical four columns, a generic document store.
--
--     id          text
--     doc         jsonb
--     created_at  timestamptz
--     updated_at  timestamptz
--
-- Written here so the shape survives the drop; recreating one is four lines if
-- a use for it ever appears.
--
-- WHAT WAS CHECKED BEFORE DROPPING, because a dropped table does not come back:
--
--   rows now                  0, all six
--   rows ever inserted        0, all six — pg_stat_user_tables has counted every
--                             write since the database was created, and not one
--                             row has ever been put in any of them
--   foreign keys              none, in either direction
--   views depending on them   none. Seven views mention the word "notes", every
--                             one of them the column on quotations, orders and
--                             the rest — not this table. Checked by matching
--                             FROM/JOIN rather than the bare word.
--   functions and triggers    none
--   application code          none, across the backend, the three front ends,
--                             the scripts and the migrations
--
-- So nothing reads them, nothing writes them, nothing points at them, and no
-- data is lost. The software cannot tell the difference.
--
-- The DROPs are guarded anyway: if a row has appeared between the check and the
-- migration running, the migration fails rather than destroying it.

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_chats', 'conversations', 'messages', 'notes', 'receipts', 'webhook_events']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'public.% is already gone', t;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'public.% holds % row(s) — refusing to drop it', t, n;
    END IF;

    -- RESTRICT, not CASCADE: if something has come to depend on it since the
    -- checks above, the right outcome is to stop, not to take that with it.
    EXECUTE format('DROP TABLE public.%I RESTRICT', t);
    RAISE NOTICE 'dropped public.%', t;
  END LOOP;
END;
$$;
