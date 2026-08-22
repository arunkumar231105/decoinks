-- 112_customer_contact_roles.sql
--
-- customer_contacts already exists — sixteen fields, a cascade to the customer,
-- and a partial unique index so only one contact per customer can be primary.
-- The whole stack supports it: the customer form collects contacts, the API
-- validates them, the service writes them. It holds zero rows.
--
-- What it cannot answer is the question a company with ten contacts actually
-- raises: which of them do I send this to? job_title is free text — "Manager"
-- tells the shop nothing about who approves an artwork or who pays an invoice —
-- so today the answer lives in somebody's memory.
--
-- Four fields, all nullable, all additive:
--
--   contact_role   what this person is the contact FOR, from a fixed list, so
--                  the system can find the billing contact without reading a
--                  job title. A person can hold several roles; that is one row
--                  each, which is also how one of them gets to be primary.
--   department     where they sit — free text, because company structures are
--                  not ours to standardise.
--   is_active      people leave. Soft-deleting them would erase the fact that
--                  they were the contact on last year's invoice; this retires
--                  them without rewriting history.
--   preferred_contact_method  the shop runs on WhatsApp as much as email, and
--                  the record should say which one this person answers.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS contact_role             VARCHAR(30),
  ADD COLUMN IF NOT EXISTS department               VARCHAR(120),
  ADD COLUMN IF NOT EXISTS is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR(20);

ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS chk_customer_contacts_role;
ALTER TABLE customer_contacts ADD CONSTRAINT chk_customer_contacts_role CHECK (
  contact_role IS NULL OR contact_role IN
    ('BILLING','SHIPPING','ARTWORK','PRODUCTION','PURCHASING','OWNER','GENERAL')
);

ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS chk_customer_contacts_method;
ALTER TABLE customer_contacts ADD CONSTRAINT chk_customer_contacts_method CHECK (
  preferred_contact_method IS NULL OR preferred_contact_method IN
    ('EMAIL','PHONE','MOBILE','WHATSAPP')
);

-- A contact has to be reachable somehow, or the row says nothing.
ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS chk_customer_contacts_reachable;
ALTER TABLE customer_contacts ADD CONSTRAINT chk_customer_contacts_reachable CHECK (
  COALESCE(NULLIF(TRIM(email),''), NULLIF(TRIM(phone),''),
           NULLIF(TRIM(mobile_number),''), NULLIF(TRIM(whatsapp),'')) IS NOT NULL
  OR COALESCE(NULLIF(TRIM(first_name),''), NULLIF(TRIM(last_name),'')) IS NOT NULL
);

-- Finding the right person is the point, so make that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_customer_contacts_role
  ON customer_contacts(customer_id, contact_role)
  WHERE deleted_at IS NULL AND is_active;

-- One person, one role, per customer — a company does not have two billing
-- contacts, and if it does, one of them is the primary.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_contacts_one_per_role
  ON customer_contacts(customer_id, contact_role)
  WHERE contact_role IS NOT NULL AND deleted_at IS NULL AND is_active;
