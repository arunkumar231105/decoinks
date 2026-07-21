-- Customers workspace: canonical status values, CRM fields, missing indexes,
-- and customer_number backfill for legacy rows. No business data is invented.

-- 1. Canonical lowercase status set. The table currently holds a mix of
--    'Active'/'Inactive'/'Blocked' (migration 026 CHECK) and 'prospect'
--    (inserted by customers.service). Normalise everything and re-add a
--    single authoritative constraint.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
UPDATE customers SET status = LOWER(status) WHERE status IS NOT NULL AND status <> LOWER(status);
UPDATE customers SET status = 'active'
WHERE status IS NULL OR status NOT IN ('prospect','active','inactive','blocked','archived');
ALTER TABLE customers ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE customers ALTER COLUMN status SET NOT NULL;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('prospect','active','inactive','blocked','archived'));

-- 2. CRM fields used by the Customers workspace. All nullable; historical
--    rows stay NULL rather than being backfilled with invented values.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS job_title         VARCHAR(120),
  -- VARCHAR by convention: migration 041 dropped the payment_terms enum
  ADD COLUMN IF NOT EXISTS payment_terms     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS credit_limit      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS chk_customers_customer_type,
  ADD CONSTRAINT chk_customers_customer_type
    CHECK (customer_type IS NULL OR customer_type IN ('business','individual','non_profit')),
  DROP CONSTRAINT IF EXISTS chk_customers_credit_limit,
  ADD CONSTRAINT chk_customers_credit_limit
    CHECK (credit_limit IS NULL OR credit_limit >= 0),
  DROP CONSTRAINT IF EXISTS chk_customers_payment_terms,
  ADD CONSTRAINT chk_customers_payment_terms
    CHECK (payment_terms IS NULL OR payment_terms IN ('Due on Receipt', 'Net 15', 'Net 30', 'Net 60'));

-- 3. Backfill customer_number for legacy rows, continuing each year's
--    existing CUST-YYYY-NNNN sequence. getNextNumber() re-seeds from the
--    table MAX under an advisory lock, so new numbers keep incrementing
--    safely after this backfill.
WITH maxes AS (
  SELECT SPLIT_PART(customer_number, '-', 2) AS yr,
         MAX(CAST(SPLIT_PART(customer_number, '-', 3) AS INTEGER)) AS max_seq
  FROM customers
  WHERE customer_number ~ '^CUST-[0-9]{4}-[0-9]+$'
  GROUP BY 1
),
numbered AS (
  SELECT id,
         TO_CHAR(created_at, 'YYYY') AS yr,
         ROW_NUMBER() OVER (PARTITION BY TO_CHAR(created_at, 'YYYY') ORDER BY created_at, id) AS seq
  FROM customers
  WHERE customer_number IS NULL
)
UPDATE customers c
SET customer_number = 'CUST-' || n.yr || '-' || LPAD((n.seq + COALESCE(m.max_seq, 0))::TEXT, 4, '0')
FROM numbered n
LEFT JOIN maxes m ON m.yr = n.yr
WHERE c.id = n.id;

-- 4. Indexes for the workspace list / sort / aggregate paths.
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id     ON invoices(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_created_active ON customers(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name_lower     ON customers(LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_segment        ON customers(customer_segment) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_type           ON customers(customer_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_agent          ON customers(assigned_agent_id) WHERE deleted_at IS NULL;
