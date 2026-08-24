-- 116_three_values_the_move_had_no_column_for.sql
--
-- The lines were copied into the new tables and then every column was counted
-- on both sides, field by field, not just row by row. Three values had no
-- column waiting for them. This adds the columns so the count comes out level.
--
--  artwork_size   186 DTF lines (153 quotation, 33 invoice) record the transfer
--                 as the shop writes it: "3x2.2", "10.9x14". Those same lines
--                 also carry width and height as numbers, and the two always
--                 agree — checked, not assumed: no line has one without the
--                 other. The numbers are what the system should calculate on,
--                 but the text is what the shop typed and what the screens
--                 show, and "10.9x14" is not what NUMERIC(6,2) reads back.
--                 Keeping it means the page can print the line exactly as it
--                 always has. The name matches purchase_order_items.artwork_size,
--                 which holds the same thing in the same format.
--
--  unit_of_measure  The two gangsheet quotation lines carry 'pcs' like every
--                 other line. Apparel and DTF have somewhere to put it; the new
--                 gangsheet tables did not.
--
--  item_name      A purchase order line has both a name (the customer or
--                 artwork it is for — "UNIQUE STAFFING", "B&B CLEAN") and a
--                 description. po_dtf_items has both; po_apparel_items only had
--                 the description, so the move had to put the name in the notes
--                 field, which is not where anyone would look for it.

ALTER TABLE quotation_items_dtf       ADD COLUMN IF NOT EXISTS artwork_size    VARCHAR(80);
ALTER TABLE invoice_items_dtf         ADD COLUMN IF NOT EXISTS artwork_size    VARCHAR(80);

ALTER TABLE quotation_items_gangsheet ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20);
ALTER TABLE invoice_items_gangsheet   ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20);

ALTER TABLE po_apparel_items          ADD COLUMN IF NOT EXISTS item_name       VARCHAR(255);
