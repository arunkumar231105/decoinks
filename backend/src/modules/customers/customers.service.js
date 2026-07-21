const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

// Business rules shared by every aggregate below: an order counts when it is
// not soft-deleted and not Draft/Cancelled; an invoice balance counts when it
// is positive and the invoice is not Void.
const ELIGIBLE_ORDERS = `ord.deleted_at IS NULL AND ord.status NOT IN ('Draft', 'Cancelled')`
const OPEN_INVOICES = `inv.customer_id = c.id AND inv.status <> 'Void' AND COALESCE(inv.balance_due, 0) > 0`

const STATUSES = ['prospect', 'active', 'inactive', 'blocked', 'archived']
const PAYMENT_TERMS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 60']

const SORT_COLUMNS = {
  created_at: 'created_at',
  name: 'LOWER(display_name)',
  customer_number: 'customer_number',
  contact: 'LOWER(contact_person)',
  status: 'status',
  last_order: 'last_order_date',
  total_orders: 'total_orders',
  total_spent: 'total_spent',
  outstanding_balance: 'outstanding_balance',
}

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') return value
  const lowered = String(value).toLowerCase()
  return STATUSES.includes(lowered) ? lowered : value
}

function buildFilters(f) {
  // Conditions on customer columns (applied inside the CTE)…
  const conditions = ['c.deleted_at IS NULL']
  // …and conditions on aggregate columns (applied over the CTE).
  const post = []
  const params = []
  const add = (value, sql, target = conditions) => {
    params.push(value)
    target.push(sql(params.length))
  }

  if (f.search) {
    add(`%${f.search}%`, n =>
      `(c.name ILIKE $${n} OR CONCAT_WS(' ', c.first_name, c.last_name) ILIKE $${n}
        OR c.company_name ILIKE $${n} OR c.company ILIKE $${n} OR c.email ILIKE $${n}
        OR c.phone ILIKE $${n} OR c.company_phone_number ILIKE $${n} OR c.mobile_number ILIKE $${n}
        OR c.whatsapp ILIKE $${n} OR c.customer_number ILIKE $${n})`)
  }
  if (f.customer_type) add(f.customer_type, n => `c.customer_type = $${n}`)
  if (f.segment) add(f.segment, n => `COALESCE(c.customer_segment, c.buyer_type) ILIKE $${n}`)
  if (f.status && f.status !== 'All') add(normalizeStatus(f.status), n => `c.status = $${n}`)
  if (f.state) add(f.state, n => `c.state ILIKE $${n}`)
  if (f.country) add(f.country, n => `c.country ILIKE $${n}`)
  if (f.payment_terms) add(f.payment_terms, n => `c.payment_terms = $${n}`)
  if (f.assigned_agent) add(f.assigned_agent, n => `c.assigned_agent_id = $${n}`)
  if (f.date_from) add(f.date_from, n => `c.created_at >= $${n}::date`)
  if (f.date_to) add(f.date_to, n => `c.created_at < ($${n}::date + INTERVAL '1 day')`)

  if (f.has_balance === 'true') post.push('outstanding_balance > 0')
  if (f.has_balance === 'false') post.push('outstanding_balance = 0')
  if (f.has_overdue === 'true') post.push('overdue_balance > 0')
  if (f.min_orders !== '' && f.min_orders !== undefined && !Number.isNaN(+f.min_orders)) {
    add(+f.min_orders, n => `total_orders >= $${n}`, post)
  }
  if (f.max_orders !== '' && f.max_orders !== undefined && !Number.isNaN(+f.max_orders)) {
    add(+f.max_orders, n => `total_orders <= $${n}`, post)
  }
  if (f.min_spent !== '' && f.min_spent !== undefined && !Number.isNaN(+f.min_spent)) {
    add(+f.min_spent, n => `total_spent >= $${n}`, post)
  }
  if (f.max_spent !== '' && f.max_spent !== undefined && !Number.isNaN(+f.max_spent)) {
    add(+f.max_spent, n => `total_spent <= $${n}`, post)
  }

  return {
    where: `WHERE ${conditions.join(' AND ')}`,
    postWhere: post.length ? `WHERE ${post.join(' AND ')}` : '',
    params,
  }
}

// One CTE feeds count + data queries so aggregate filters and sorts stay
// consistent. LATERAL subqueries hit idx_orders_customer_id /
// idx_invoices_customer_id, so this stays cheap at the current data size.
// Explicit column list: customers also carries cached total_orders /
// lifetime_value / last_order_at columns (migration 047) that are not
// maintained — the live aggregates below are authoritative.
const CUSTOMER_COLUMNS = `
  c.id, c.customer_number, c.lead_id, c.name, c.first_name, c.last_name,
  c.email, c.phone, c.whatsapp, c.company, c.company_name, c.website,
  c.facebook_id, c.instagram_id, c.address_line1, c.city, c.state, c.zip,
  c.country, c.billing_address, c.same_as_shipping, c.buyer_type,
  c.customer_segment, c.tier, c.preferred_language, c.company_phone_number,
  c.mobile_number, c.internal_notes, c.source, c.status, c.customer_type,
  c.job_title, c.payment_terms, c.credit_limit, c.assigned_agent_id,
  c.created_by, c.created_at, c.updated_at`

function baseCte(where) {
  return `
    WITH base AS (
      SELECT ${CUSTOMER_COLUMNS},
        u.name AS agent_name,
        COALESCE(NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(c.company), ''), c.name) AS display_name,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS contact_person,
        COALESCE(NULLIF(c.company_phone_number, ''), NULLIF(c.phone, ''), NULLIF(c.mobile_number, '')) AS primary_phone,
        COALESCE(NULLIF(c.customer_segment, ''), NULLIF(c.buyer_type, '')) AS segment,
        o.total_orders, o.total_spent, o.avg_order_value,
        lo.last_order_date, lo.last_order_number,
        i.outstanding_balance, i.overdue_balance, i.open_invoices
      FROM customers c
      LEFT JOIN users u ON u.id = c.assigned_agent_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS total_orders,
               COALESCE(SUM(ord.total), 0)::NUMERIC(14,2) AS total_spent,
               CASE WHEN COUNT(*) > 0 THEN ROUND(COALESCE(SUM(ord.total), 0) / COUNT(*), 2) END AS avg_order_value
        FROM orders ord
        WHERE ord.customer_id = c.id AND ${ELIGIBLE_ORDERS}
      ) o ON TRUE
      LEFT JOIN LATERAL (
        SELECT ord.order_date AS last_order_date, ord.order_number AS last_order_number
        FROM orders ord
        WHERE ord.customer_id = c.id AND ${ELIGIBLE_ORDERS}
        ORDER BY ord.order_date DESC, ord.created_at DESC
        LIMIT 1
      ) lo ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(inv.balance_due), 0)::NUMERIC(14,2) AS outstanding_balance,
               COALESCE(SUM(inv.balance_due) FILTER (
                 WHERE inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE
               ), 0)::NUMERIC(14,2) AS overdue_balance,
               COUNT(*)::INT AS open_invoices
        FROM invoices inv
        WHERE ${OPEN_INVOICES}
      ) i ON TRUE
      ${where}
    )`
}

async function list(options = {}) {
  const page = Math.max(1, Number(options.page) || 1)
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 10))
  const offset = (page - 1) * limit
  const { where, postWhere, params } = buildFilters(options)

  const cte = baseCte(where)
  const countRes = await query(`${cte} SELECT COUNT(*) FROM base ${postWhere}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  const orderColumn = SORT_COLUMNS[options.sort_by] || SORT_COLUMNS.created_at
  const orderDirection = String(options.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const dataParams = [...params, limit, offset]
  const { rows } = await query(
    `${cte}
     SELECT * FROM base ${postWhere}
     ORDER BY ${orderColumn} ${orderDirection} NULLS LAST, id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  )
  return { rows, total }
}

async function getStats() {
  const [customers, orders, balance] = await Promise.all([
    query(`SELECT
        COUNT(*)::INT AS total_customers,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::INT AS new_customers,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
                           AND created_at < date_trunc('month', CURRENT_DATE))::INT AS new_customers_prev,
        COUNT(*) FILTER (WHERE status = 'active')::INT AS active_customers
      FROM customers WHERE deleted_at IS NULL`),
    query(`WITH per_customer AS (
        SELECT ord.customer_id, COUNT(*) AS order_count, SUM(ord.total) AS spent
        FROM orders ord
        JOIN customers c ON c.id = ord.customer_id AND c.deleted_at IS NULL
        WHERE ${ELIGIBLE_ORDERS}
        GROUP BY ord.customer_id
      )
      SELECT
        COUNT(*) FILTER (WHERE order_count > 1)::INT AS repeat_customers,
        COALESCE(ROUND(SUM(spent) / NULLIF(SUM(order_count), 0), 2), 0) AS avg_order_value,
        COALESCE(ROUND(AVG(spent), 2), 0) AS lifetime_value
      FROM per_customer`),
    query(`SELECT COALESCE(SUM(inv.balance_due), 0)::NUMERIC(14,2) AS outstanding_balance
      FROM invoices inv
      JOIN customers c ON c.id = inv.customer_id AND c.deleted_at IS NULL
      WHERE ${OPEN_INVOICES}`),
  ])
  return { ...customers.rows[0], ...orders.rows[0], ...balance.rows[0] }
}

async function getFilterOptions() {
  const [types, segments, states, countries, agents] = await Promise.all([
    query(`SELECT DISTINCT customer_type AS value FROM customers
           WHERE deleted_at IS NULL AND customer_type IS NOT NULL ORDER BY value`),
    query(`SELECT DISTINCT COALESCE(NULLIF(customer_segment, ''), NULLIF(buyer_type, '')) AS value
           FROM customers WHERE deleted_at IS NULL
             AND COALESCE(NULLIF(customer_segment, ''), NULLIF(buyer_type, '')) IS NOT NULL
           ORDER BY value`),
    query(`SELECT DISTINCT state AS value FROM customers
           WHERE deleted_at IS NULL AND NULLIF(TRIM(state), '') IS NOT NULL ORDER BY value`),
    query(`SELECT DISTINCT country AS value FROM customers
           WHERE deleted_at IS NULL AND NULLIF(TRIM(country), '') IS NOT NULL ORDER BY value`),
    query(`SELECT id AS value, name AS label FROM users WHERE is_active = TRUE ORDER BY name`),
  ])
  return {
    types: types.rows, segments: segments.rows, states: states.rows,
    countries: countries.rows, payment_terms: PAYMENT_TERMS.map(value => ({ value })), agents: agents.rows,
    statuses: STATUSES.map(value => ({ value })),
  }
}

async function getById(id) {
  // Guard against non-UUID ids causing PostgreSQL cast errors
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) {
    throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  }
  const cte = baseCte('WHERE c.deleted_at IS NULL AND c.id = $1')
  const { rows } = await query(`${cte} SELECT * FROM base`, [id])
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  const customer = rows[0]

  const [addresses, quotes, lastPayment, lastInvoice, activity] = await Promise.all([
    query(`SELECT * FROM customer_addresses WHERE customer_id = $1
           ORDER BY is_default DESC, address_type, created_at`, [id]),
    query(`SELECT id, quote_number, status, total, created_at FROM quotations
           WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    query(`SELECT p.amount, p.paid_at, p.payment_method FROM payments p
           JOIN invoices inv ON inv.id = p.invoice_id
           WHERE inv.customer_id = $1 ORDER BY p.paid_at DESC LIMIT 1`, [id]),
    query(`SELECT invoice_number, total, balance_due, status, issue_date FROM invoices
           WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]),
    query(`SELECT description, created_at, user_name FROM (
             SELECT al.description, al.created_at, u.name AS user_name
             FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
             WHERE al.entity_type = 'customer' AND al.entity_id = $1
             UNION ALL
             SELECT 'Order ' || ord.order_number || ' created', ord.created_at, NULL
             FROM orders ord WHERE ord.customer_id = $1 AND ord.deleted_at IS NULL
             UNION ALL
             SELECT 'Invoice ' || inv.invoice_number || ' issued', inv.created_at, NULL
             FROM invoices inv WHERE inv.customer_id = $1
             UNION ALL
             SELECT 'Payment of $' || p.amount || ' received', p.paid_at, NULL
             FROM payments p JOIN invoices inv ON inv.id = p.invoice_id
             WHERE inv.customer_id = $1
             UNION ALL
             SELECT 'Quotation ' || q.quote_number || ' created', q.created_at, NULL
             FROM quotations q WHERE q.customer_id = $1
           ) events
           ORDER BY created_at DESC LIMIT 20`, [id]),
  ])

  return {
    ...customer,
    customer_no: customer.customer_number,
    addresses: addresses.rows,
    quotes: quotes.rows,
    quotes_count: quotes.rows.length,
    last_payment: lastPayment.rows[0] || null,
    last_invoice: lastInvoice.rows[0] || null,
    activity: activity.rows,
    available_credit: customer.credit_limit == null
      ? null
      : Math.max(0, Number(customer.credit_limit) - Number(customer.outstanding_balance || 0)),
  }
}

async function create({ lead_id, name, email, phone, whatsapp, company, website, facebook_id, instagram_id,
  address_line1, city, state, zip, country, billing_address, same_as_shipping,
  buyer_type, internal_notes, source, created_by,
  first_name, last_name, company_name, company_phone_number, mobile_number,
  preferred_language, customer_segment, tier, status,
  customer_type, job_title, payment_terms, credit_limit, assigned_agent_id, addresses = [] }) {
  const displayName = name || [first_name, last_name].filter(Boolean).join(' ')
  if (!displayName) throw Object.assign(new Error('First name is required'), { statusCode: 400 })
  const customer_number = await getNextNumber('CUST', 'customers', 'customer_number')
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO customers
         (customer_number, lead_id, name, email, phone, whatsapp, company, website, facebook_id, instagram_id,
          address_line1, city, state, zip, country, billing_address, same_as_shipping,
          buyer_type, internal_notes, source, created_by, first_name, last_name, company_name,
          company_phone_number, mobile_number, preferred_language, customer_segment, tier,
          customer_type, job_title, payment_terms, credit_limit, assigned_agent_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       RETURNING *`,
      [
        customer_number, lead_id || null, displayName,
        email || null, company_phone_number || phone || null, whatsapp || null, company_name || company || null,
        website || null, facebook_id || null, instagram_id || null,
        address_line1 || null, city || null, state || null, zip || null,
        country || 'United States', billing_address || null, same_as_shipping || false,
        customer_segment || buyer_type || null, internal_notes || null, source || null, created_by,
        first_name || displayName.split(' ')[0], last_name || null, company_name || company || null,
        company_phone_number || phone || null, mobile_number || null, preferred_language || 'en',
        customer_segment || buyer_type || null, tier || null,
        customer_type || null, job_title || null, payment_terms || null,
        credit_limit ?? null, assigned_agent_id || null,
        normalizeStatus(status) || 'prospect',
      ]
    )
    const customer = rows[0]

    const normalizedAddresses = addresses.length ? addresses : [
      ...(address_line1 ? [{ address_type: 'shipping', line1: address_line1, city, state, zipcode: zip, country, is_default: true }] : []),
      ...(billing_address ? [{ address_type: 'billing', line1: billing_address, country, is_default: true }] : []),
    ]
    for (const a of normalizedAddresses) {
      await client.query(
        `INSERT INTO customer_addresses
           (customer_id,address_type,line1,line2,city,state,zipcode,country,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [customer.id, a.address_type, a.line1 || null, a.line2 || null, a.city || null,
         a.state || null, a.zipcode || null, a.country || null, a.is_default || false]
      )
    }

    // Link lead to this customer
    if (lead_id) {
      await client.query(
        `UPDATE leads SET customer_id = $1, updated_at = NOW() WHERE id = $2`,
        [customer.id, lead_id]
      )
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'customer', $2, 'created', $3)`,
      [created_by, customer.id, `Customer ${customer_number} - ${displayName} created`]
    )
    await client.query('COMMIT')
    return customer
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505' && String(err.constraint || '').includes('email')) {
      throw Object.assign(new Error('A customer with this email already exists'), { statusCode: 409 })
    }
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields, actorId) {
  const allowed = [
    'name', 'email', 'phone', 'whatsapp', 'company', 'website', 'facebook_id', 'instagram_id',
    'address_line1', 'city', 'state', 'zip', 'country', 'billing_address', 'same_as_shipping',
    'buyer_type', 'internal_notes', 'status', 'source', 'first_name', 'last_name',
    'company_name', 'company_phone_number', 'mobile_number', 'preferred_language',
    'customer_segment', 'tier',
    'customer_type', 'job_title', 'payment_terms', 'credit_limit', 'assigned_agent_id',
  ]
  const sets = []
  const params = []
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(key === 'status' ? normalizeStatus(fields[key]) : fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
  params.push(id)
  let rows
  try {
    ({ rows } = await query(
      `UPDATE customers SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params
    ))
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('email')) {
      throw Object.assign(new Error('A customer with this email already exists'), { statusCode: 409 })
    }
    throw err
  }
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  if (fields.status !== undefined) {
    try {
      await query(
        `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
         VALUES ($1, 'customer', $2, 'status_changed', $3)`,
        [actorId || null, id, `Status changed to ${normalizeStatus(fields.status)}`]
      )
    } catch { /* non-fatal */ }
  }
  return rows[0]
}

async function remove(id) {
  const { rows } = await query(
    `UPDATE customers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
}

module.exports = { list, getStats, getFilterOptions, getById, create, update, remove }
