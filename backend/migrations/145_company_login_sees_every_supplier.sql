-- 145: the Fulfillment Portal as Decoinks' own Supplier Management System.
--
-- The owner, 17 Sep 2026: the portal should not be one supplier's — it should
-- show every purchase order in Printshop, and the "digi" login becomes
-- "decoinks" (same password). A login with sees_all_suppliers reads every live
-- PO and the sales orders they cover, whichever supplier each went to
-- (backend/src/modules/supplier-portal/portal.scope.js). Other supplier logins
-- are unchanged and still see only what was shared with them.

ALTER TABLE supplier_portal_users
  ADD COLUMN IF NOT EXISTS sees_all_suppliers BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE supplier_portal_users
   SET username = 'decoinks', sees_all_suppliers = TRUE, updated_at = NOW()
 WHERE LOWER(username) = 'digi'
   AND NOT EXISTS (SELECT 1 FROM supplier_portal_users WHERE LOWER(username) = 'decoinks');
