-- A quotation keeps the date it was quoted on.
--
-- The quote form has a Quote Date field, but nothing stored it: the lists and the
-- print showed the row's created_at, so a quote keyed in today for work quoted
-- (and paid) days earlier could not be given its real date — editing the field
-- changed nothing. It is its own column now, editable like Entry Date.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS quote_date DATE;

-- Every existing quote keeps the day it shows today: created_at, read in the
-- shop's time zone (utils/shopTime.js).
UPDATE quotations
   SET quote_date = (created_at AT TIME ZONE 'Asia/Karachi')::date
 WHERE quote_date IS NULL AND created_at IS NOT NULL;

-- Any insert that does not say (imports, the CRM, lead conversion) gets the
-- entry date, or the day it is written.
CREATE OR REPLACE FUNCTION quotations_default_quote_date()
RETURNS trigger AS $$
BEGIN
  IF NEW.quote_date IS NULL THEN
    NEW.quote_date := COALESCE(NEW.entry_date, (COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Karachi')::date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotations_default_quote_date ON quotations;
CREATE TRIGGER trg_quotations_default_quote_date
  BEFORE INSERT ON quotations
  FOR EACH ROW EXECUTE FUNCTION quotations_default_quote_date();

COMMENT ON COLUMN quotations.quote_date IS 'The date the work was quoted — the Quote Date on the form, lists and print.';
