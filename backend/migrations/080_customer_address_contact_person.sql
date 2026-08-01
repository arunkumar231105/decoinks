-- 080_customer_address_contact_person.sql
-- Add a per-address "contact person" (ship-to / attention) name.
--
-- Why: a customer account (e.g. "Moutaz Mamlouk") can need an order delivered
-- to a different named recipient (e.g. "Bashar Mamlouk"). That recipient name
-- previously had nowhere to live, so it was being mis-stored in company_name /
-- first_name. This column gives the recipient its own home on each address.
--
-- Additive + idempotent + nullable. No existing behaviour changes: readers that
-- do not select this column are unaffected.

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(160);  -- ship-to / attention name for this address
