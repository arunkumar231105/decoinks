const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

const STATUSES = ['Completed', 'Pending', 'Failed', 'Refunded']

// One SELECT list shared by list/getById so both views agree.
const COLUMNS = `
  p.id, p.payment_number, p.payment_date, p.paid_at, p.amount, p.payment_method,
  p.item_amount, p.shipping_amount,
  p.received_from_name, p.received_into_account_id,
  p.sender_bank_name, p.sender_account_name, p.sender_account_last4, p.sender_reference,
  p.reference_no, p.status, p.notes, p.invoice_id, p.order_id, p.customer_id,
  p.created_at, p.updated_at,
  acc.account_name AS received_into_account, acc.account_type AS received_into_type,
  COALESCE(NULLIF(TRIM(p.customer_name), ''), c.name, i.customer_name, o.shipping_name) AS customer_name,
  i.invoice_number, o.order_number, u.name AS recorded_by_name`

const FROM = `
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN invoices  i ON i.id = p.invoice_id
  LEFT JOIN orders    o ON o.id = p.order_id
  LEFT JOIN users     u ON u.id = p.recorded_by
  LEFT JOIN payment_accounts acc ON acc.id = p.received_into_account_id`

function buildWhere(f = {}) {
  const conditions = []
  const params = []
  const add = (value, sql) => { params.push(value); conditions.push(sql(params.length)) }

  if (f.search) {
    add(`%${f.search}%`, n =>
      `(p.payment_number ILIKE $${n} OR p.reference_no ILIKE $${n} OR p.payment_method ILIKE $${n}
        OR COALESCE(p.customer_name, '') ILIKE $${n} OR COALESCE(c.name, '') ILIKE $${n}
        OR COALESCE(i.invoice_number, '') ILIKE $${n} OR COALESCE(o.order_number, '') ILIKE $${n}
        OR COALESCE(p.received_from_name, '') ILIKE $${n} OR COALESCE(p.sender_bank_name, '') ILIKE $${n}
        OR COALESCE(acc.account_name, '') ILIKE $${n})`)
  }
  if (f.status && f.status !== 'All') add(f.status, n => `p.status = $${n}`)
  if (f.payment_method) add(f.payment_method, n => `p.payment_method = $${n}`)
  if (f.customer_id) add(f.customer_id, n => `p.customer_id = $${n}`)
  if (f.order_id) add(f.order_id, n => `p.order_id = $${n}`)
  if (f.account_id) add(f.account_id, n => `p.received_into_account_id = $${n}`)
  if (f.date_from) add(f.date_from, n => `COALESCE(p.payment_date, p.paid_at::date) >= $${n}::date`)
  if (f.date_to) add(f.date_to, n => `COALESCE(p.payment_date, p.paid_at::date) <= $${n}::date`)

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

async function list(options = {}) {
  const page = Math.max(1, Number(options.page) || 1)
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 10))
  const offset = (page - 1) * limit
  const { where, params } = buildWhere(options)

  const countRes = await query(`SELECT COUNT(*) ${FROM} ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  const dataParams = [...params, limit, offset]
  const { rows } = await query(
    `SELECT ${COLUMNS} ${FROM} ${where}
     ORDER BY COALESCE(p.payment_date, p.paid_at::date) DESC, p.created_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  )
  return { rows, total }
}

async function getStats(filters = {}) {
  const { where, params } = buildWhere(filters)
  const { rows } = await query(
    `SELECT COUNT(*)::INT AS total_payments,
            COALESCE(SUM(p.amount), 0)::NUMERIC(14,2) AS total_amount,
            COALESCE(SUM(p.item_amount), 0)::NUMERIC(14,2) AS total_item,
            COALESCE(SUM(p.shipping_amount), 0)::NUMERIC(14,2) AS total_shipping,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'Completed'), 0)::NUMERIC(14,2) AS completed_amount,
            COUNT(*) FILTER (WHERE p.status = 'Pending')::INT AS pending_count,
            COALESCE(AVG(p.amount), 0)::NUMERIC(14,2) AS average_payment,
            COUNT(DISTINCT p.customer_id)::INT AS paying_customers
     ${FROM} ${where}`, params)
  return rows[0]
}

async function getById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) {
    throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
  }
  const { rows } = await query(`SELECT ${COLUMNS} ${FROM} WHERE p.id = $1`, [id])
  if (!rows[0]) throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
  return rows[0]
}

async function create(data) {
  const {
    payment_date, payment_method, reference_no, notes, status,
    customer_id, order_id, invoice_id, customer_name, recorded_by,
    received_from_name, received_into_account_id,
    sender_bank_name, sender_account_name, sender_account_last4, sender_reference,
  } = data

  // The total is always the two components added up — the database enforces
  // the same rule, so deriving it here keeps the API from ever disagreeing.
  const item = Number(data.item_amount ?? 0)
  const shipping = Number(data.shipping_amount ?? 0)
  const amount = +(item + shipping).toFixed(2)

  if (!(item >= 0 && shipping >= 0)) {
    throw Object.assign(new Error('Item and shipping amounts cannot be negative'), { statusCode: 400 })
  }
  if (!(amount > 0)) {
    throw Object.assign(new Error('Item + shipping must be greater than zero'), { statusCode: 400 })
  }
  const payment_number = await getNextNumber('PAY', 'payments', 'payment_number')

  const client = await getClient()
  try {
    await client.query('BEGIN')
    // Snapshot the customer name so the record still reads correctly if the
    // customer is later renamed or unlinked.
    let name = customer_name || null
    if (!name && customer_id) {
      const r = await client.query('SELECT name FROM customers WHERE id = $1', [customer_id])
      name = r.rows[0]?.name || null
    }
    const { rows } = await client.query(
      `INSERT INTO payments
         (payment_number, payment_date, paid_at, amount, item_amount, shipping_amount,
          payment_method, reference_no, notes, status,
          customer_id, order_id, invoice_id, customer_name, recorded_by,
          received_from_name, received_into_account_id,
          sender_bank_name, sender_account_name, sender_account_last4, sender_reference)
       VALUES ($1, $2, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [payment_number, payment_date || null, amount, item, shipping,
       payment_method || 'Bank Transfer', reference_no || null, notes || null, status || 'Completed',
       customer_id || null, order_id || null, invoice_id || null, name, recorded_by || null,
       received_from_name || name || null, received_into_account_id || null,
       sender_bank_name || null, sender_account_name || null,
       sender_account_last4 || null, sender_reference || null]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields) {
  const allowed = ['payment_date', 'payment_method', 'reference_no', 'notes',
                   'status', 'customer_id', 'order_id', 'invoice_id', 'customer_name',
                   'item_amount', 'shipping_amount', 'received_from_name', 'received_into_account_id',
                   'sender_bank_name', 'sender_account_name', 'sender_account_last4', 'sender_reference']

  // Editing either component re-derives the total, so the stored amount can
  // never drift from its parts.
  if (fields.item_amount !== undefined || fields.shipping_amount !== undefined) {
    const current = (await query('SELECT item_amount, shipping_amount FROM payments WHERE id = $1', [id])).rows[0]
    if (!current) throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
    const item = Number(fields.item_amount ?? current.item_amount)
    const shipping = Number(fields.shipping_amount ?? current.shipping_amount)
    fields = { ...fields, amount: +(item + shipping).toFixed(2) }
    allowed.push('amount')
  }
  const sets = []
  const params = []
  for (const key of allowed) {
    if (fields[key] !== undefined) { params.push(fields[key]); sets.push(`${key} = $${params.length}`) }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
  params.push(id)
  const { rows } = await query(
    `UPDATE payments SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} RETURNING *`, params)
  if (!rows[0]) throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
  return rows[0]
}

async function remove(id) {
  const { rows } = await query('DELETE FROM payments WHERE id = $1 RETURNING id', [id])
  if (!rows[0]) throw Object.assign(new Error('Payment not found'), { statusCode: 404 })
  return { id }
}

async function getFilterOptions() {
  const [methods, customers, accounts] = await Promise.all([
    query(`SELECT DISTINCT payment_method AS value FROM payments
           WHERE NULLIF(TRIM(payment_method), '') IS NOT NULL ORDER BY value`),
    query(`SELECT DISTINCT p.customer_id AS value, COALESCE(c.name, p.customer_name) AS label
           FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
           WHERE p.customer_id IS NOT NULL ORDER BY label`),
    query(`SELECT id AS value, account_name AS label, account_type, is_default
             FROM payment_accounts WHERE is_active ORDER BY is_default DESC, account_name`),
  ])
  return {
    methods: methods.rows,
    customers: customers.rows,
    accounts: accounts.rows,
    statuses: STATUSES.map(value => ({ value })),
  }
}

module.exports = { list, getStats, getById, create, update, remove, getFilterOptions, STATUSES }
