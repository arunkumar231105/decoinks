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

// ── Overview: single payload powering the redesigned dashboard ───────────────
// Every figure is computed for the requested period [from..to] and compared
// against the immediately-preceding period of equal length. Product-type
// breakdown: dtf + gangsheet = "DTF Transfers", apparel = "Custom Shirts".
// Customer split: customer created inside the period = "New Customers".

const iso = d => d.toISOString().slice(0, 10)

function resolvePeriod(date_from, date_to) {
  const reDate = /^\d{4}-\d{2}-\d{2}$/
  const now = new Date()
  let to = reDate.test(date_to || '') ? new Date(date_to + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let from = reDate.test(date_from || '') ? new Date(date_from + 'T00:00:00Z') : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  if (from > to) [from, to] = [to, from]
  const days = Math.round((to - from) / 86400000) + 1
  const prevTo = new Date(from.getTime() - 86400000)
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000)
  return { from: iso(from), to: iso(to), prev_from: iso(prevFrom), prev_to: iso(prevTo), days }
}

async function getOverview({ date_from, date_to } = {}) {
  const p = resolvePeriod(date_from, date_to)
  const cacheKey = `dashboard:overview:v1:${p.from}:${p.to}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  // $1=from $2=to $3=prev_from $4=prev_to — ranges are inclusive of both ends.
  const params = [p.from, p.to, p.prev_from, p.prev_to]
  const CUR = col => `(${col} >= $1::date AND ${col} < ($2::date + INTERVAL '1 day'))`
  const PREV = col => `(${col} >= $3::date AND ${col} < ($4::date + INTERVAL '1 day'))`

  const [leads, quotes, pays, orders, pos, custs, trendCur, trendPrev,
         recentPays, recentPos, recentShips, shipCount] = await Promise.all([

    // Leads created in period + qualified subset, with product-type detection
    query(`SELECT
        COUNT(*) FILTER (WHERE cur)::int AS cnt, COUNT(*) FILTER (WHERE prev)::int AS prev,
        COUNT(*) FILTER (WHERE cur AND ptype='dtf')::int AS dtf,
        COUNT(*) FILTER (WHERE cur AND ptype='shirt')::int AS shirt,
        COUNT(*) FILTER (WHERE cur AND is_qual)::int AS q_cnt,
        COUNT(*) FILTER (WHERE prev AND is_qual)::int AS q_prev,
        COUNT(*) FILTER (WHERE cur AND is_qual AND ptype='dtf')::int AS q_dtf,
        COUNT(*) FILTER (WHERE cur AND is_qual AND ptype='shirt')::int AS q_shirt
      FROM (
        SELECT ${CUR('l.created_at')} AS cur, ${PREV('l.created_at')} AS prev,
          (l.qualified_at IS NOT NULL OR COALESCE(l.conversion_score,0) >= 60) AS is_qual,
          CASE WHEN pi.txt ~* 'dtf|gangsheet|transfer' THEN 'dtf'
               WHEN NULLIF(TRIM(pi.txt), '') IS NOT NULL THEN 'shirt' END AS ptype
        FROM leads l
        LEFT JOIN LATERAL (
          SELECT COALESCE(l.product_interest,'') || ' ' || COALESCE(STRING_AGG(lpi.product_type,' '),'') AS txt
          FROM lead_product_interest lpi WHERE lpi.lead_id = l.id
        ) pi ON TRUE
        WHERE l.deleted_at IS NULL
      ) x`, params),

    // Quotations actually sent (sent_at set, or moved past Draft)
    query(`SELECT
        COUNT(*) FILTER (WHERE cur)::int AS cnt, COUNT(*) FILTER (WHERE prev)::int AS prev,
        COUNT(*) FILTER (WHERE cur AND ot IN ('dtf','gangsheet'))::int AS dtf,
        COUNT(*) FILTER (WHERE cur AND ot = 'apparel')::int AS shirt
      FROM (
        SELECT COALESCE(q.sent_at, q.created_at) AS sat, q.order_type::text AS ot,
          ${CUR('COALESCE(q.sent_at, q.created_at)')} AS cur,
          ${PREV('COALESCE(q.sent_at, q.created_at)')} AS prev
        FROM quotations q
        WHERE (q.sent_at IS NOT NULL OR q.status::text NOT IN ('Draft'))
      ) x`, params),

    // Payments received (real ledger) with type + new/existing customer splits
    query(`SELECT
        COUNT(DISTINCT inv_id) FILTER (WHERE cur)::int AS cnt,
        COUNT(DISTINCT inv_id) FILTER (WHERE prev)::int AS prev,
        COALESCE(SUM(amount) FILTER (WHERE cur),0)::numeric(14,2) AS val,
        COALESCE(SUM(amount) FILTER (WHERE prev),0)::numeric(14,2) AS val_prev,
        COUNT(DISTINCT inv_id) FILTER (WHERE cur AND dtfish)::int AS dtf,
        COUNT(DISTINCT inv_id) FILTER (WHERE cur AND NOT dtfish)::int AS shirt,
        COUNT(DISTINCT inv_id) FILTER (WHERE cur AND newcust)::int AS ncust,
        COUNT(DISTINCT inv_id) FILTER (WHERE cur AND NOT newcust)::int AS ecust,
        COALESCE(SUM(amount) FILTER (WHERE cur AND newcust),0)::numeric(14,2) AS ncust_val,
        COALESCE(SUM(amount) FILTER (WHERE cur AND NOT newcust),0)::numeric(14,2) AS ecust_val
      FROM (
        SELECT pay.invoice_id AS inv_id, pay.amount,
          ${CUR('pay.paid_at')} AS cur, ${PREV('pay.paid_at')} AS prev,
          COALESCE(i.order_type,'') IN ('dtf','gangsheet') AS dtfish,
          COALESCE(${CUR('fo.first_order')}, FALSE) AS newcust
        FROM payments pay
        JOIN invoices i ON i.id = pay.invoice_id AND i.status::text <> 'Void'
        LEFT JOIN LATERAL (
          SELECT MIN(o2.order_date) AS first_order FROM orders o2
          WHERE o2.customer_id = i.customer_id AND o2.deleted_at IS NULL
            AND o2.status::text NOT IN ('Draft','Cancelled')
        ) fo ON i.customer_id IS NOT NULL
      ) x`, params),

    // Orders: issued counts/values, reached-stage funnel, pendings, splits
    query(`SELECT
        COUNT(*)                FILTER (WHERE cur AND issued)::int AS so_cnt,
        COUNT(*)                FILTER (WHERE prev AND issued)::int AS so_prev,
        COALESCE(SUM(total)     FILTER (WHERE cur AND issued),0)::numeric(14,2) AS so_val,
        COALESCE(SUM(total)     FILTER (WHERE prev AND issued),0)::numeric(14,2) AS so_val_prev,
        COUNT(*)                FILTER (WHERE cur AND issued AND dtfish)::int AS so_dtf,
        COUNT(*)                FILTER (WHERE cur AND issued AND NOT dtfish)::int AS so_shirt,
        COUNT(*)                FILTER (WHERE cur AND issued AND newcust)::int AS so_ncust,
        COUNT(*)                FILTER (WHERE cur AND issued AND NOT newcust)::int AS so_ecust,
        COALESCE(SUM(total)     FILTER (WHERE cur AND issued AND dtfish),0)::numeric(14,2) AS so_dtf_val,
        COALESCE(SUM(total)     FILTER (WHERE cur AND issued AND NOT dtfish),0)::numeric(14,2) AS so_shirt_val,
        COALESCE(SUM(total)     FILTER (WHERE cur AND issued AND newcust),0)::numeric(14,2) AS so_ncust_val,
        COALESCE(SUM(total)     FILTER (WHERE cur AND issued AND NOT newcust),0)::numeric(14,2) AS so_ecust_val,
        COUNT(*) FILTER (WHERE cur AND st_prod)::int AS pr_cnt,
        COUNT(*) FILTER (WHERE prev AND st_prod)::int AS pr_prev,
        COUNT(*) FILTER (WHERE cur AND st_prod AND dtfish)::int AS pr_dtf,
        COUNT(*) FILTER (WHERE cur AND st_prod AND NOT dtfish)::int AS pr_shirt,
        COUNT(*) FILTER (WHERE cur AND st_prod AND newcust)::int AS pr_ncust,
        COUNT(*) FILTER (WHERE cur AND st_prod AND NOT newcust)::int AS pr_ecust,
        COUNT(*) FILTER (WHERE cur AND st_ship)::int AS sh_cnt,
        COUNT(*) FILTER (WHERE prev AND st_ship)::int AS sh_prev,
        COUNT(*) FILTER (WHERE cur AND st_ship AND dtfish)::int AS sh_dtf,
        COUNT(*) FILTER (WHERE cur AND st_ship AND NOT dtfish)::int AS sh_shirt,
        COUNT(*) FILTER (WHERE cur AND st_ship AND newcust)::int AS sh_ncust,
        COUNT(*) FILTER (WHERE cur AND st_ship AND NOT newcust)::int AS sh_ecust,
        COUNT(*) FILTER (WHERE cur AND st_del)::int AS de_cnt,
        COUNT(*) FILTER (WHERE prev AND st_del)::int AS de_prev,
        COUNT(*) FILTER (WHERE cur AND st_del AND dtfish)::int AS de_dtf,
        COUNT(*) FILTER (WHERE cur AND st_del AND NOT dtfish)::int AS de_shirt,
        COUNT(*) FILTER (WHERE cur AND st_del AND newcust)::int AS de_ncust,
        COUNT(*) FILTER (WHERE cur AND st_del AND NOT newcust)::int AS de_ecust,
        COUNT(*) FILTER (WHERE cur AND status = 'Draft')::int AS so_pending,
        COUNT(*) FILTER (WHERE cur AND issued AND has_po)::int AS po_orders_cnt,
        COUNT(*) FILTER (WHERE cur AND issued AND NOT has_po)::int AS po_pending,
        COUNT(*) FILTER (WHERE cur AND status = 'Confirmed')::int AS pr_pending,
        COUNT(*) FILTER (WHERE cur AND status IN ('In Production','Ready to Ship'))::int AS sh_pending,
        COUNT(*) FILTER (WHERE cur AND status = 'Shipped')::int AS de_pending
      FROM (
        SELECT o.total, o.status::text AS status,
          o.order_type::text IN ('dtf','gangsheet') AS dtfish,
          (o.status::text <> 'Draft') AS issued,
          o.status::text IN ('In Production','Ready to Ship','Shipped','Delivered') AS st_prod,
          o.status::text IN ('Shipped','Delivered') AS st_ship,
          (o.status::text = 'Delivered') AS st_del,
          -- "New customer" = this customer's FIRST eligible order falls inside
          -- the period (not the customer record's creation date, which is
          -- meaningless for imported customer books).
          COALESCE(${CUR('fo.first_order')}, FALSE) AS newcust,
          ${CUR('o.order_date')} AS cur, ${PREV('o.order_date')} AS prev,
          EXISTS (SELECT 1 FROM po_orders poo
                  JOIN purchase_orders po2 ON po2.id = poo.po_id AND po2.deleted_at IS NULL
                  WHERE poo.order_id = o.id) AS has_po
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT MIN(o2.order_date) AS first_order FROM orders o2
          WHERE o2.customer_id = o.customer_id AND o2.deleted_at IS NULL
            AND o2.status::text NOT IN ('Draft','Cancelled')
        ) fo ON o.customer_id IS NOT NULL
        WHERE o.deleted_at IS NULL AND o.status::text <> 'Cancelled'
      ) x`, params),

    // Purchase orders issued in period
    query(`SELECT
        COUNT(*) FILTER (WHERE cur)::int AS cnt, COUNT(*) FILTER (WHERE prev)::int AS prev,
        COUNT(*) FILTER (WHERE cur AND po_type='gangsheet')::int AS dtf,
        COUNT(*) FILTER (WHERE cur AND po_type='apparel')::int AS shirt,
        COUNT(*) FILTER (WHERE cur AND newcust)::int AS ncust,
        COUNT(*) FILTER (WHERE cur AND NOT newcust)::int AS ecust
      FROM (
        SELECT po.po_type, ${CUR("COALESCE(po.order_date, po.created_at::date)")} AS cur,
          ${PREV("COALESCE(po.order_date, po.created_at::date)")} AS prev,
          COALESCE(${CUR('c.created_at')}, FALSE) AS newcust
        FROM purchase_orders po
        LEFT JOIN customers c ON c.id = po.customer_id
        WHERE po.deleted_at IS NULL AND po.status::text <> 'Cancelled'
      ) x`, params),

    // Customer base
    query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${CUR('created_at')})::int AS new_cnt,
        COUNT(*) FILTER (WHERE ${PREV('created_at')})::int AS new_prev
      FROM customers WHERE deleted_at IS NULL`, params),

    // Daily revenue/order trend — current period
    query(`WITH days AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS d)
      SELECT to_char(d.d,'YYYY-MM-DD') AS date,
        COALESCE((SELECT SUM(pp.amount) FROM payments pp
                  JOIN invoices ii ON ii.id = pp.invoice_id AND ii.status::text <> 'Void'
                  WHERE pp.paid_at::date = d.d),0)::numeric(14,2) AS revenue,
        (SELECT COUNT(*) FROM orders oo WHERE oo.deleted_at IS NULL
           AND oo.status::text NOT IN ('Draft','Cancelled') AND oo.order_date = d.d)::int AS orders
      FROM days d ORDER BY d.d`, [p.from, p.to]),

    // Daily trend — previous period (aligned by index on the client)
    query(`WITH days AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS d)
      SELECT to_char(d.d,'YYYY-MM-DD') AS date,
        COALESCE((SELECT SUM(pp.amount) FROM payments pp
                  JOIN invoices ii ON ii.id = pp.invoice_id AND ii.status::text <> 'Void'
                  WHERE pp.paid_at::date = d.d),0)::numeric(14,2) AS revenue,
        (SELECT COUNT(*) FROM orders oo WHERE oo.deleted_at IS NULL
           AND oo.status::text NOT IN ('Draft','Cancelled') AND oo.order_date = d.d)::int AS orders
      FROM days d ORDER BY d.d`, [p.prev_from, p.prev_to]),

    // Recents
    query(`SELECT pay.paid_at, pay.amount, pay.payment_method::text AS method,
        COALESCE(c.name, i.customer_name, '—') AS customer,
        i.invoice_number, i.id AS invoice_id, o.order_number
      FROM payments pay
      JOIN invoices i ON i.id = pay.invoice_id
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN orders o ON o.id = i.order_id
      ORDER BY pay.paid_at DESC LIMIT 5`),

    query(`SELECT po.id, po.po_number, COALESCE(po.order_date, po.created_at::date) AS po_date,
        po.status::text AS status, o.order_number AS source_order, s.name AS vendor
      FROM purchase_orders po
      LEFT JOIN orders o ON o.id = po.order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.deleted_at IS NULL
      ORDER BY po.created_at DESC LIMIT 5`),

    query(`SELECT sh.id, COALESCE(sh.ship_date, sh.created_at::date) AS ship_date,
        sh.tracking_number, sh.carrier, sh.status::text AS status,
        COALESCE(sh.recipient_name, c.name, o.contact_name, '—') AS customer
      FROM shipments sh
      LEFT JOIN orders o ON o.id = sh.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      ORDER BY sh.created_at DESC LIMIT 5`),

    query(`SELECT COUNT(*)::int AS cnt FROM shipments sh
      WHERE ${CUR("COALESCE(sh.ship_date, sh.created_at::date)")}`, [p.from, p.to]),
  ])

  const L = leads.rows[0], Q = quotes.rows[0], P2 = pays.rows[0], O = orders.rows[0], PO = pos.rows[0], C = custs.rows[0]
  const n = v => Number(v) || 0

  const result = {
    period: p,
    pipeline: {
      leads:       { count: n(L.cnt),  prev: n(L.prev),  dtf: n(L.dtf),  shirt: n(L.shirt) },
      qualified:   { count: n(L.q_cnt), prev: n(L.q_prev), dtf: n(L.q_dtf), shirt: n(L.q_shirt) },
      quotes:      { count: n(Q.cnt),  prev: n(Q.prev),  dtf: n(Q.dtf),  shirt: n(Q.shirt) },
      payments:    { count: n(P2.cnt), prev: n(P2.prev), dtf: n(P2.dtf), shirt: n(P2.shirt), value: n(P2.val), value_prev: n(P2.val_prev) },
      sales_orders:{ count: n(O.so_cnt), prev: n(O.so_prev), dtf: n(O.so_dtf), shirt: n(O.so_shirt), value: n(O.so_val), value_prev: n(O.so_val_prev), pending: n(O.so_pending) },
      po:          { count: n(PO.cnt), prev: n(PO.prev), dtf: n(PO.dtf), shirt: n(PO.shirt), pending: n(O.po_pending), orders_covered: n(O.po_orders_cnt) },
      production:  { count: n(O.pr_cnt), prev: n(O.pr_prev), dtf: n(O.pr_dtf), shirt: n(O.pr_shirt), pending: n(O.pr_pending) },
      shipped:     { count: n(O.sh_cnt), prev: n(O.sh_prev), dtf: n(O.sh_dtf), shirt: n(O.sh_shirt), pending: n(O.sh_pending) },
      delivered:   { count: n(O.de_cnt), prev: n(O.de_prev), dtf: n(O.de_dtf), shirt: n(O.de_shirt), pending: n(O.de_pending) },
    },
    customers: {
      total: n(C.total), new: n(C.new_cnt), existing: n(C.total) - n(C.new_cnt), new_prev: n(C.new_prev),
      payments:     { new: n(P2.ncust), existing: n(P2.ecust), new_value: n(P2.ncust_val), existing_value: n(P2.ecust_val) },
      sales_orders: { new: n(O.so_ncust), existing: n(O.so_ecust), new_value: n(O.so_ncust_val), existing_value: n(O.so_ecust_val) },
      po:           { new: n(PO.ncust), existing: n(PO.ecust) },
      production:   { new: n(O.pr_ncust), existing: n(O.pr_ecust) },
      shipped:      { new: n(O.sh_ncust), existing: n(O.sh_ecust) },
      delivered:    { new: n(O.de_ncust), existing: n(O.de_ecust) },
    },
    sales_by_type: [
      { key: 'dtf',     label: 'DTF Transfers', value: n(O.so_dtf_val),   count: n(O.so_dtf) },
      { key: 'apparel', label: 'Custom Shirts', value: n(O.so_shirt_val), count: n(O.so_shirt) },
    ],
    sales_by_customer: [
      { key: 'existing', label: 'Existing Customers', value: n(O.so_ecust_val), count: n(O.so_ecust) },
      { key: 'new',      label: 'New Customers',      value: n(O.so_ncust_val), count: n(O.so_ncust) },
    ],
    trend: { current: trendCur.rows, previous: trendPrev.rows },
    recent: {
      payments: recentPays.rows,
      pos: recentPos.rows,
      shipments: recentShips.rows,
      payments_total: { count: n(P2.cnt), value: n(P2.val) },
      pos_total: n(PO.cnt),
      shipments_total: n(shipCount.rows[0].cnt),
    },
  }

  await cacheSet(cacheKey, result, TTL)
  return result
}

module.exports = { getStats, getLeadPipeline, getOrdersByStatus, getTopSuppliers, getRecentActivity, getOverview }
