-- 150: DIGI order numbers Printshop only learns from a person (the owner, 17 Sep 2026).
--
-- DIGI's API cannot list orders — every order call needs the order numbers.
-- The sync finds them in BlankTex and on Printshop POs and sales orders, but an
-- order placed straight on DIGI's website appears in none of those. Numbers
-- pasted on the Supplier Order Management page are kept here, and the sync
-- follows them like any other. Additive.

CREATE TABLE IF NOT EXISTS digi_order_numbers (
  order_no    VARCHAR(64) PRIMARY KEY,
  found_on_api BOOLEAN,                     -- whether DIGI knew the number when it was added
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
