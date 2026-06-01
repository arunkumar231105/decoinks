const { query } = require('../../config/db')
const { cacheGet, cacheSet } = require('../../config/redis')

const TTL = 60

async function getStats() {
  const cacheKey = 'dashboard:stats'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const prevMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0]
  const prevMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0]

  const [leadsToday, leadsYesterday, activeQuotes, pendingOrders, revenueMonth, revenuePrevMonth] = await Promise.all([
    query(`SELECT COUNT(*) FROM leads WHERE DATE(created_at) = $1 AND deleted_at IS NULL`, [today]),
    query(`SELECT COUNT(*) FROM leads WHERE DATE(created_at) = $1 AND deleted_at IS NULL`, [yesterday]),
    query(`SELECT COUNT(*) FROM quotations WHERE status IN ('Draft','Sent')`),
    query(`SELECT COUNT(*) FROM orders WHERE status IN ('Draft','Confirmed','In Production') AND deleted_at IS NULL`),
    query(`SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'Paid' AND issue_date >= $1`, [monthStart]),
    query(`SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'Paid' AND issue_date >= $1 AND issue_date <= $2`, [prevMonthStart, prevMonthEnd]),
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
    active_quotes: parseInt(activeQuotes.rows[0].count, 10),
    pending_orders: parseInt(pendingOrders.rows[0].count, 10),
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
  const cacheKey = 'dashboard:orders-by-status'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const weekStart = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const { rows } = await query(
    `SELECT status, COUNT(*) AS count
     FROM orders
     WHERE deleted_at IS NULL AND order_date >= $1
     GROUP BY status ORDER BY count DESC`,
    [weekStart]
  )
  const result = rows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) }))
  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getTopSuppliers() {
  const cacheKey = 'dashboard:top-suppliers'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT s.id, s.name AS supplier, COALESCE(SUM(o.total), 0) AS revenue
     FROM suppliers s
     LEFT JOIN orders o ON o.supplier_id = s.id AND o.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
     GROUP BY s.id, s.name
     ORDER BY revenue DESC
     LIMIT 5`
  )
  const result = rows.map((r) => ({ supplier: r.supplier, revenue: parseFloat(r.revenue) }))
  await cacheSet(cacheKey, result, TTL)
  return result
}

async function getRecentActivity() {
  const cacheKey = 'dashboard:recent-activity'
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const { rows } = await query(
    `SELECT al.*, u.name AS user_name
     FROM activity_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC LIMIT 20`
  )
  await cacheSet(cacheKey, rows, 30)
  return rows
}

module.exports = { getStats, getLeadPipeline, getOrdersByStatus, getTopSuppliers, getRecentActivity }
