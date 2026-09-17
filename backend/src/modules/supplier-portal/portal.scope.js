/**
 * Who a portal login speaks for, and which purchase orders and sales orders
 * that puts in front of it.
 *
 * A supplier's login sees what the shop shared with that supplier
 * (portal_po_visibility / portal_order_visibility). The company login
 * (supplier_portal_users.sees_all_suppliers, migration 145) runs the portal as
 * Decoinks' own Supplier Management System: every live purchase order in
 * Printshop, whichever supplier it went to, and every sales order one covers.
 *
 * Services take a scope id: the supplier's id, or null for the company login.
 * The SQL below reads that one parameter both ways, so a query is written once.
 */

const httpError = (status, message) => Object.assign(new Error(message), { status })

/** The scope id for a request: null only for a company login's token. */
function scopeId(req) {
  if (req.supplier?.allSuppliers === true) return null
  const id = req.supplier?.supplierId
  if (!id) throw httpError(403, 'This login is not linked to a supplier')
  return id
}

/** Purchase orders in scope, as (po_id, supplier_id). `$n` is the scope id. */
const PO_SCOPE = (n) => `(
  SELECT v.po_id, v.supplier_id
    FROM portal_po_visibility v
   WHERE v.is_visible = TRUE AND v.supplier_id = $${n}::uuid
  UNION ALL
  SELECT p.id, p.supplier_id
    FROM purchase_orders p
   WHERE $${n}::uuid IS NULL AND p.deleted_at IS NULL
)`

/**
 * Sales orders in scope, as (order_id, supplier_id, sent_at). For the company
 * login supplier_id is NULL — an order can carry POs to more than one supplier.
 */
const ORDER_SCOPE = (n) => `(
  SELECT v.order_id, v.supplier_id, v.sent_at
    FROM portal_order_visibility v
   WHERE v.is_visible = TRUE AND v.supplier_id = $${n}::uuid
  UNION ALL
  SELECT o.id, NULL::uuid, MIN(p.created_at)
    FROM orders o
    JOIN purchase_orders p
      ON p.deleted_at IS NULL
     AND (p.order_id = o.id OR EXISTS (SELECT 1 FROM po_orders x WHERE x.po_id = p.id AND x.order_id = o.id))
   WHERE $${n}::uuid IS NULL AND o.deleted_at IS NULL
   GROUP BY o.id
)`

module.exports = { scopeId, PO_SCOPE, ORDER_SCOPE, httpError }
