-- Artwork file naming standard: AW-<CLIENT>-<NNNN>-<TYPE>.<ext>
--
-- The vault previously recognised five type codes (SRC, WRK, MOCK, OUT, FNL).
-- The shop's published standard has seven — it adds REF (reference material),
-- FNLA (the version the customer approved, the only one that goes to
-- production), GS (print-ready gang sheet) and MU (mockup), and drops nothing.
--
-- Widening the CHECK is additive: every value that was legal stays legal, no
-- row is rewritten, and the two retired-but-still-present codes (MOCK, OUT)
-- remain accepted so the 1 073 existing rows that use them are untouched.

ALTER TABLE artwork_vault_assets
  DROP CONSTRAINT IF EXISTS artwork_vault_assets_lifecycle_code_check;

ALTER TABLE artwork_vault_assets
  ADD CONSTRAINT artwork_vault_assets_lifecycle_code_check
  CHECK (lifecycle_code IS NULL OR lifecycle_code::text = ANY (ARRAY[
    'SRC',    -- source: raw file the customer sent
    'REF',    -- reference material / "make it like this"
    'WRK',    -- work in progress (what Design Studio saves)
    'FNL',    -- final, sent for sign-off but NOT yet approved
    'FNLA',   -- final approved: the master that goes to production
    'GS',     -- gang sheet
    'MU',     -- mockup
    'MOCK',   -- legacy alias of MU, still present on existing rows
    'OUT'     -- legacy: files already sent to the customer
  ]));

-- Filtering by lifecycle is now a first-class control in both the PrintShop
-- vault and the Design Studio vault; the existing index already covers it.
