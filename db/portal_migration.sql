-- ============================================================
--  portal_migration.sql  –  Customer Portal Schema
--  Run ONCE after init.sql (Docker auto-mounts as 02_portal.sql)
-- ============================================================

-- 1. Customer portal login accounts
CREATE TABLE IF NOT EXISTS customer_portal_users (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  username       VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login     TIMESTAMPTZ,
  must_change_pw BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by     UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_users_customer ON customer_portal_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_username ON customer_portal_users(username);

-- 2. Order visibility control
CREATE TABLE IF NOT EXISTS portal_order_visibility (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sent_by      UUID        REFERENCES users(id),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_visible   BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE(order_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_vis_customer ON portal_order_visibility(customer_id);
CREATE INDEX IF NOT EXISTS idx_portal_vis_order    ON portal_order_visibility(order_id);

-- 3. Purchase order visibility control
CREATE TABLE IF NOT EXISTS portal_po_visibility (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id        UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sent_by      UUID        REFERENCES users(id),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_visible   BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE(po_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_po_vis_customer ON portal_po_visibility(customer_id);

-- 4. Portal notifications
CREATE TABLE IF NOT EXISTS portal_notifications (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type         VARCHAR(50)  NOT NULL,
  title        VARCHAR(255) NOT NULL,
  message      TEXT,
  reference_id UUID,
  is_read      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_notif_customer ON portal_notifications(customer_id, is_read);
