const { query } = require('../../config/db')
const { cacheGet, cacheSet } = require('../../config/redis')

const TTL = 30

async function getStats() {
  const cacheKey = 'dashboard:stats:v2'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const prevMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0]
  const prevMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0]

  const [leadsToday, leadsYesterday, totals, revenueMonth, revenuePrevMonth] = await Promise.all([
    query(`SELECT COUNT(*) FROM leads WHERE DATE(created_at) = $1 AND deleted_at IS NULL`, [today]),
    query(`SELECT COUNT(*) FROM leads WHERE DATE(created_at) = $1 AND deleted_at IS NULL`, [yesterday]),
    query(`SELECT
      (SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL)::int AS total_leads,
      (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL)::int AS total_customers,
      (SELECT COUNT(*) FROM quotations)::int AS total_quotes,
      (SELECT COUNT(*) FROM quotations WHERE status='Approved')::int AS approved_quotes,
      (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL)::int AS total_orders,
      (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status='Delivered')::int AS delivered_orders,
      (SELECT COUNT(*) FROM invoices)::int AS total_invoices,
      (SELECT COUNT(*) FROM invoices WHERE status='Paid')::int AS paid_invoices,
      (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL)::int AS total_purchase_orders,
      (SELECT COALESCE(SUM(amount_paid),0) FROM invoices WHERE status!='Void')::numeric(12,2) AS lifetime_revenue,
      (SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE status!='Void')::numeric(12,2) AS outstanding_revenue,
      (SELECT COALESCE(SUM(total_artworks),0) FROM purchase_orders WHERE deleted_at IS NULL)::int AS total_artworks,
      (SELECT COALESCE(SUM(total_gangsheets),0) FROM purchase_orders WHERE deleted_at IS NULL)::int AS total_gangsheets`),
    query(`SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status != 'Void'::invoice_status AND COALESCE(issue_date, created_at::date) >= $1`, [monthStart]),
    query(`SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status != 'Void'::invoice_status AND COALESCE(issue_date, created_at::date) >= $1 AND COALESCE(issue_date, created_at::date) <= $2`, [prevMonthStart, prevMonthEnd]),
  ])

  const todayCount = parseInt(leadsToday.rows[0].count, 10)
  const yestCount = parseInt(leadsYesterday.rows[0].count, 10)
  const revNow = parseFloat(revenueMonth.rows[0].coalesce) || 0
  const revPrev = parseFloat(revenuePrevMonth.rows[0].coalesce) || 0
  const leadsChangePct = yestCount > 0 ? Math.round(((todayCount - yestCount) / yestCount) * 100) : 0
  const revenueChangePct = revPrev > 0 ? Math.round(((revNow - revPrev) / revPrev) * 100) : 0

  const result = {
    leads_today: todayCount,
    leads_today_change_pct: leadsChangePct,
    ...totals.rows[0],
    revenue_this_month: revNow,
    revenue_change_pct: revenueChangePct,
  }

  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getLeadPipeline() {
  const cacheKey = 'dashboard:lead-pipeline'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT stage, COUNT(*) AS count
     FROM leads WHERE deleted_at IS NULL
     GROUP BY stage
     ORDER BY stage`
  )

  const stages = ['initiated', 'quotation', 'artwork', 'gangsheet', 'payment', 'confirmed']
  const countMap = {}
  for (const r of rows) countMap[r.stage] = parseInt(r.count, 10)
  const result = stages.map((s) => ({ stage: s, count: countMap[s] || 0 }))

  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getOrdersByStatus() {
  const cacheKey = 'dashboard:orders-by-status:v2'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT status, COUNT(*) AS count
     FROM orders
     WHERE deleted_at IS NULL
     GROUP BY status ORDER BY count DESC`
  )
  const result = rows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) }))
  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getTopSuppliers() {
  const cacheKey = 'dashboard:top-customers:v2'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT c.id, c.name AS supplier, COALESCE(SUM(i.amount_paid), 0) AS revenue
     FROM customers c
     LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'Void'
     WHERE c.deleted_at IS NULL
     GROUP BY c.id, c.name
     ORDER BY revenue DESC
     LIMIT 5`
  )
  const result = rows.map((r) => ({ supplier: r.supplier, revenue: parseFloat(r.revenue) }))
  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getRecentActivity() {
  const cacheKey = 'dashboard:recent-activity:v2'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT * FROM (
       SELECT al.id::text, INITCAP(al.entity_type) AS entity_type, al.action,
              al.created_at, u.name AS user_name
       FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id
       UNION ALL
       SELECT 'quote-'||q.id::text, 'Quotation', q.quote_number||' · '||q.status,
              q.created_at, u.name
       FROM quotations q LEFT JOIN users u ON u.id=q.created_by
       UNION ALL
       SELECT 'order-'||o.id::text, 'Order', o.order_number||' · '||o.status,
              o.created_at, u.name
       FROM orders o LEFT JOIN users u ON u.id=o.created_by WHERE o.deleted_at IS NULL
       UNION ALL
       SELECT 'invoice-'||i.id::text, 'Invoice', i.invoice_number||' · '||i.status,
              i.created_at, u.name
       FROM invoices i LEFT JOIN users u ON u.id=i.created_by
       UNION ALL
       SELECT 'po-'||po.id::text, 'Purchase Order', po.po_number||' · '||po.status,
              po.created_at, u.name
       FROM purchase_orders po LEFT JOIN users u ON u.id=po.created_by WHERE po.deleted_at IS NULL
     ) activity
     ORDER BY created_at DESC LIMIT 20`
  )
  await cacheSet(cacheKey, rows, 30)
  return rows
}

module.exports = { getStats, getLeadPipeline, getOrdersByStatus, getTopSuppliers, getRecentActivity }
