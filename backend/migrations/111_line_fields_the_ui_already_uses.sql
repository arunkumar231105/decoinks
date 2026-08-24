-- 111_line_fields_the_ui_already_uses.sql
--
-- Before any of this reaches production, the new line tables were checked
-- against what the current ones actually hold — because a column the shop fills
-- today with no home in the new design is a field that disappears the moment the
-- code switches over.
--
-- Four came up, all on the apparel side, and all already present on
-- order_items_apparel — so a quotation could not carry what its own sales order
-- can, and copying a line forward would lose them:
--
--   brand              filled on 227 of the 306 live quotation lines. "Gildan"
--                      is not decoration; it is what the shop buys.
--   decoration_method  filled on 199. How the garment is printed — DTF, screen,
--                      embroidery. It appears nowhere in the new design at all.
--   category           filled on 64.
--   model              filled on 46.
--
-- product_id was also checked and is filled on none, so it is not carried over.
--
-- Added to the quotation and invoice apparel tables, matching the names and
-- types order_items_apparel already uses, so a line copies across the chain
-- without translation.

ALTER TABLE quotation_items_apparel
  ADD COLUMN IF NOT EXISTS brand             VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model             VARCHAR(120),
  ADD COLUMN IF NOT EXISTS category          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);

ALTER TABLE invoice_items_apparel
  ADD COLUMN IF NOT EXISTS brand             VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model             VARCHAR(120),
  ADD COLUMN IF NOT EXISTS category          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);

-- order_items_apparel already has brand, model and category; only the
-- decoration method is missing there too.
ALTER TABLE order_items_apparel
  ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);

-- And on the PO, so the supplier is told how it is printed.
ALTER TABLE po_apparel_items
  ADD COLUMN IF NOT EXISTS brand             VARCHAR(120),
  ADD COLUMN IF NOT EXISTS decoration_method VARCHAR(40);
