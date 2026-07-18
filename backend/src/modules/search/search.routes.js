const { Router } = require('express')
const { query } = require('../../config/db')
const { verifyToken } = require('../../middleware/auth')
const { success } = require('../../utils/response')

const router = Router()
router.use(verifyToken)

// Runs a query but never lets one failing table break the whole search.
async function safe(sql, params) {
  try {
    const { rows } = await query(sql, params)
    return rows
  } catch {
    return []
  }
}

// GET /api/search?q=...  → grouped results across the main entities.
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (q.length < 2) return success(res, { results: [], q })

    const like = `%${q}%`
    const L = 5

    const [customers, suppliers, orders, quotes, invoices, purchaseOrders, products] = await Promise.all([
      safe(
        `SELECT id, name, company, customer_number
         FROM customers
         WHERE deleted_at IS NULL
           AND (name ILIKE $1 OR email ILIKE $1 OR company ILIKE $1 OR customer_number ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, name, company
         FROM suppliers
         WHERE deleted_at IS NULL
           AND (name ILIKE $1 OR email ILIKE $1 OR company ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, order_number, status, contact_name
         FROM orders
         WHERE deleted_at IS NULL
           AND (order_number ILIKE $1 OR contact_name ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, quote_number, status, customer_name, company_name
         FROM quotations
         WHERE (quote_number ILIKE $1 OR customer_name ILIKE $1 OR company_name ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, invoice_number, status, customer_name
         FROM invoices
         WHERE (invoice_number ILIKE $1 OR customer_name ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, po_number, status, vendor_name
         FROM purchase_orders
         WHERE deleted_at IS NULL
           AND (po_number ILIKE $1 OR vendor_name ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
      safe(
        `SELECT id, name, sku, brand
         FROM integration.blanktex_decoinks_styles
         WHERE deleted_at IS NULL
           AND (name ILIKE $1 OR sku ILIKE $1 OR brand ILIKE $1)
         ORDER BY created_at DESC LIMIT ${L}`, [like]),
    ])

    const results = [
      ...customers.map(c => ({ type: 'Customer', id: c.id, label: c.name, sub: c.company || c.customer_number || '', to: `/customers/${c.id}` })),
      ...suppliers.map(s => ({ type: 'Supplier', id: s.id, label: s.name, sub: s.company || '', to: `/suppliers/${s.id}` })),
      ...orders.map(o => ({ type: 'Order', id: o.id, label: o.order_number, sub: [o.contact_name, o.status].filter(Boolean).join(' · '), to: `/orders/${o.id}` })),
      ...quotes.map(qt => ({ type: 'Quote', id: qt.id, label: qt.quote_number, sub: [qt.customer_name || qt.company_name, qt.status].filter(Boolean).join(' · '), to: `/quotes/${qt.id}` })),
      ...invoices.map(i => ({ type: 'Invoice', id: i.id, label: i.invoice_number, sub: [i.customer_name, i.status].filter(Boolean).join(' · '), to: `/invoices/${i.id}` })),
      ...purchaseOrders.map(p => ({ type: 'Purchase Order', id: p.id, label: p.po_number, sub: [p.vendor_name, p.status].filter(Boolean).join(' · '), to: `/purchase-orders/${p.id}` })),
      ...products.map(p => ({ type: 'Product', id: p.id, label: p.name, sub: [p.sku, p.brand].filter(Boolean).join(' · '), to: `/products` })),
    ]

    return success(res, { results, q })
  } catch (err) { next(err) }
})

module.exports = router
