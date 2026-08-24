-- 114_apparel_fields_history_never_recorded.sql
--
-- The last three columns standing between the existing lines and the new
-- tables. Counted against the real data before the move:
--
--   color     20 of 73 quotation apparel lines and 22 of 87 invoice apparel
--             lines have no colour. They are mostly the older imports and the
--             lines the shop wrote as a single description ("Gildan 5000 —
--             assorted"), where the colour was settled later on the order.
--   size      10 and 10, the same story.
--   style_no  There is no style column in quotation_items or invoice_items at
--             all. The closest value is the description, and writing a
--             description into a style number would put wrong data in a field
--             the shop will search on. Left empty instead, to be filled when a
--             line is next edited.
--
-- Marked Required in the spec, and rightly so for a line entered today: the
-- form should insist on all three. It cannot be insisted on backwards, against
-- rows recorded before the field existed. Holding the NOT NULL would leave 42
-- apparel lines behind, so the requirement moves to the form and the column
-- accepts what history actually holds.
--
-- Both tables are empty and unread by the application; widening what they
-- accept changes nothing about how the software behaves.

ALTER TABLE quotation_items_apparel ALTER COLUMN style_no DROP NOT NULL;
ALTER TABLE quotation_items_apparel ALTER COLUMN color    DROP NOT NULL;
ALTER TABLE quotation_items_apparel ALTER COLUMN size     DROP NOT NULL;

ALTER TABLE invoice_items_apparel   ALTER COLUMN style_no DROP NOT NULL;
ALTER TABLE invoice_items_apparel   ALTER COLUMN color    DROP NOT NULL;
ALTER TABLE invoice_items_apparel   ALTER COLUMN size     DROP NOT NULL;

-- A blank string is not a colour; keep the column honestly empty either way.
ALTER TABLE quotation_items_apparel ADD CONSTRAINT chk_quotation_items_apparel_blanks CHECK (
  style_no <> '' AND color <> '' AND size <> '');
ALTER TABLE invoice_items_apparel   ADD CONSTRAINT chk_invoice_items_apparel_blanks CHECK (
  style_no <> '' AND color <> '' AND size <> '');
