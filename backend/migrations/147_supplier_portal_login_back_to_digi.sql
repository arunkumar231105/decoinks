-- 147: the Fulfillment Portal goes back to being DIGI's own portal.
--
-- The owner, 17 Sep 2026: the Supplier Order Management system belongs in
-- Printshop, not in the supplier portal, so everything the portal gained for it
-- was taken back out. Migration 145 had turned DIGI's login into a company-wide
-- "decoinks" login; this returns it to "digi" (same password), seeing only what
-- was shared with DIGI. The sees_all_suppliers column stays, unused and false.

UPDATE supplier_portal_users
   SET username = 'digi', sees_all_suppliers = FALSE, updated_at = NOW()
 WHERE LOWER(username) = 'decoinks'
   AND NOT EXISTS (SELECT 1 FROM supplier_portal_users WHERE LOWER(username) = 'digi');
