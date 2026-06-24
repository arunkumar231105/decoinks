-- Fix enum gaps: add missing values that Zod schemas already accept

-- 1. payment_terms: add 'Paid' option
ALTER TYPE payment_terms ADD VALUE IF NOT EXISTS 'Paid';

-- 2. order_status: add 'QC' between 'In Production' and 'Ready to Ship'
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'QC' AFTER 'In Production';

-- 3. invoice_status: add 'Partially Paid'
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'Partially Paid' AFTER 'Sent';

-- 4. po_status: add all missing workflow statuses
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Pending Approval' AFTER 'Draft';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Approved' AFTER 'Pending Approval';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Accepted' AFTER 'Sent';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'In Production' AFTER 'Accepted';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Shipped' AFTER 'In Production';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Partially Received' AFTER 'Shipped';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'Closed' AFTER 'Received';
