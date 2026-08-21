-- Stop integration.data_events from growing unbounded on no-op writes.
--
-- Background: integration.capture_change() (migration 052) writes a full-row
-- JSONB snapshot on every INSERT/UPDATE/DELETE of the 11 tracked tables, with
-- no change detection. A CRM lead-sync that re-wrote unchanged rows therefore
-- produced 9.28M events (14 GB) from only ~1,300 leads -- 99.93% of them
-- identical snapshots of the same row.
--
-- This migration replaces the function so an UPDATE that changes nothing of
-- substance produces no event. Bookkeeping-only columns (updated_at,
-- updated_by) are excluded from the comparison: a write that touches nothing
-- but the audit stamps is not a data change.
--
-- Additive and schema-only: no business row is modified, and the 11 triggers
-- are left exactly as they are (they all call this one function), so no DDL
-- lock is taken on any business table. INSERT/DELETE behaviour, the payload
-- shape, the entity_id resolution order and the password/token sanitisation
-- are all unchanged.

CREATE OR REPLACE FUNCTION integration.capture_change() RETURNS trigger AS $$
DECLARE
  body JSONB;
  prev JSONB;
BEGIN
  body := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  body := body - 'password_hash' - 'token' - 'token_hash';

  IF TG_OP = 'UPDATE' THEN
    prev := to_jsonb(OLD) - 'password_hash' - 'token' - 'token_hash';
    IF (body - 'updated_at' - 'updated_by')
       IS NOT DISTINCT FROM
       (prev - 'updated_at' - 'updated_by') THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO integration.data_events
    (source_schema, source_table, operation, entity_id, payload)
  VALUES
    (TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
     COALESCE(body->>'id', body->>'customer_id', body->>'lead_id',
              body->>'order_id', body->>'purchase_id', body->>'style_id',
              body->>'artwork_id', body->>'user_id'), body);

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
