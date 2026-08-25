const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')

const STATUSES = ['Completed', 'Pending', 'Failed', 'Refunded']

// One SELECT list shared by list/getById so both views agree.
const COLUMNS = `
  p.id, p.payment_number, p.payment_date, p.paid_at, p.amount, p.payment_method,
  p.fee_amount, p.net_amount, p.transaction_id,
  p.received_from_name, p.received_into_account_id,
  p.sender_bank_name, p.sender_account_name, p.sender_account_last4, p.sender_reference,
  p.reference_no, p.status, p.notes, p.invoice_id, p.order_id, p.customer_id,
  p.created_at, p.updated_at,
  acc.account_name AS received_into_account, acc.account_type AS received_into_type,
  alloc.allocated_total, alloc.allocated_count,
  COALESCE(NULLIF(TRIM(p.customer_name), ''), c.name, i.customer_name, o.shipping_name) AS customer_name,
  i.invoice_number, o.order_number, u.name AS recorded_by_name`

const FROM = `
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN invoices  i ON i.id = p.invoice_id
  LEFT JOIN orders    o ON o.id = p.order_id
  LEFT JOIN users     u ON u.id = p.recorded_by
  LEFT JOIN payment_accounts acc ON acc.id = p.received_into_account_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.allocated_amount), 0)::NUMERIC(12,2) AS allocated_total,
           COUNT(*)::INT AS allocated_count
    FROM payment_allocations a WHERE a.payment_id = p.id
  ) alloc ON TRUE`

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
        OR COALESCE(p.transaction_id, '') ILIKE $${n}
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
            COALESCE(SUM(p.fee_amount), 0)::NUMERIC(14,2) AS total_fees,
            COALESCE(SUM(p.net_amount), 0)::NUMERIC(14,2) AS total_net,
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
  return { ...rows[0], allocations: await getAllocations(id) }
}

// One payment settles one sales order. uq_payments_one_per_order enforces it,
// but the index speaks in constraint names — this says which order is already
// settled and by which payment.
async function assertOrderUnsettled(orderId, exceptPaymentId = null) {
  if (!orderId) return
  const { rows } = await query(
    `SELECT p.payment_number, p.amount, o.order_number
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.order_id = $1 AND ($2::uuid IS NULL OR p.id <> $2)
      LIMIT 1`, [orderId, exceptPaymentId])
  if (rows.length) {
    const r = rows[0]
    const err = new Error(
      `${r.order_number} par pehle se payment ${r.payment_number} ($${Number(r.amount).toFixed(2)}) lagi hui hai. ` +
      `Ek sales order par ek hi payment lag sakti hai.`)
    err.status = 409
    throw err
  }
}

async function create(data) {
  const {
    payment_date, payment_method, reference_no, notes, status,
    customer_id, order_id, invoice_id, customer_name, recorded_by,
    received_from_name, received_into_account_id, transaction_id,
    sender_bank_name, sender_account_name, sender_account_last4, sender_reference,
    allocations,
  } = data

  await assertOrderUnsettled(order_id)

  // Shipping cost belongs to the shipment; a payment is just money in. amount
  // is the total the customer paid; net_amount = amount - fee (generated by DB).
  const amount = +Number(data.amount ?? 0).toFixed(2)
  const fee = Number(data.fee_amount ?? 0)

  if (!(amount > 0)) {
    throw Object.assign(new Error('Amount must be greater than zero'), { statusCode: 400 })
  }
  if (fee < 0 || fee > amount) {
    throw Object.assign(new Error('Fee cannot be negative or exceed the payment amount'), { statusCode: 400 })
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
         (payment_number, payment_date, paid_at, amount, fee_amount, transaction_id,
          payment_method, reference_no, notes, status,
          customer_id, order_id, invoice_id, customer_name, recorded_by,
          received_from_name, received_into_account_id,
          sender_bank_name, sender_account_name, sender_account_last4, sender_reference)
       VALUES ($1, $2, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [payment_number, payment_date || null, amount, fee, transaction_id || null,
       payment_method || 'Bank Transfer', reference_no || null, notes || null, status || 'Completed',
       customer_id || null, order_id || null, invoice_id || null, name, recorded_by || null,
       received_from_name || name || null, received_into_account_id || null,
       sender_bank_name || null, sender_account_name || null,
       sender_account_last4 || null, sender_reference || null]
    )
    // Split the payment across the orders it covers. The deferred trigger on
    // payment_allocations rejects the whole transaction if they overrun the
    // payment, so no partial write can survive.
    const lines = Array.isArray(allocations) ? allocations.filter(a => Number(a?.allocated_amount) > 0) : []
    for (const line of lines) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, line.order_id || null, line.invoice_id || null,
         Number(line.allocated_amount), line.notes || null])
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** The orders/invoices a payment was split across. */
async function getAllocations(paymentId) {
  const { rows } = await query(
    `SELECT a.id, a.allocated_amount, a.notes, a.order_id, a.invoice_id,
            o.order_number, o.shipping_name AS order_customer, i.invoice_number
       FROM payment_allocations a
       LEFT JOIN orders   o ON o.id = a.order_id
       LEFT JOIN invoices i ON i.id = a.invoice_id
      WHERE a.payment_id = $1
      ORDER BY a.created_at`, [paymentId])
  return rows
}

async function update(id, fields) {
  const allowed = ['payment_date', 'payment_method', 'reference_no', 'notes',
                   'status', 'customer_id', 'order_id', 'invoice_id', 'customer_name',
                   'amount', 'fee_amount', 'transaction_id',
                   'received_from_name', 'received_into_account_id',
                   'sender_bank_name', 'sender_account_name', 'sender_account_last4', 'sender_reference']


  if (fields.order_id) await assertOrderUnsettled(fields.order_id, id)

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

module.exports = { list, getStats, getById, create, update, remove, getFilterOptions, getAllocations, STATUSES }
