-- 100_customer_portal_users.sql
-- Portal credentials for end customers, mirroring supplier_portal_users.
--
-- Why: the Customer Portal needs its own login. Staff create the account from
-- the admin app (pick a customer, set a username/email and a password); the
-- customer then signs in with those credentials and only ever sees their own
-- records. Customers are NOT users of the admin app, so they get their own
-- table rather than a row in `users`.
--
-- Additive + idempotent. Nothing existing reads or writes this table yet.

CREATE TABLE IF NOT EXISTS customer_portal_users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  username       VARCHAR(160) NOT NULL,          -- login handle; an email is fine
  email          VARCHAR(255),                   -- contact address for the account
  password_hash  VARCHAR(255) NOT NULL,          -- bcrypt
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pw BOOLEAN NOT NULL DEFAULT FALSE, -- force a reset after staff set it
  last_login     TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usernames are the login key, so they must be unique across the portal.
-- Compared case-insensitively so "Info@X.com" and "info@x.com" cannot both exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_portal_users_username
  ON customer_portal_users (lower(username));

-- One portal account per customer (staff reset the password instead of adding
-- a second login), and the FK needs its index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_portal_users_customer
  ON customer_portal_users (customer_id);
