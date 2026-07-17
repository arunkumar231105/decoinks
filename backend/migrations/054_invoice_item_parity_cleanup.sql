-- Keep invoice line items aligned with the three quotation item forms.
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS sizes TEXT,
  ADD COLUMN IF NOT EXISTS colors TEXT;

-- This field powered the removed Print Locations UI. It was never read by the
-- application and is empty in production, so remove it instead of retaining a
-- misleading duplicate representation of artwork data.
ALTER TABLE quotation_items
  DROP COLUMN IF EXISTS print_locations;
