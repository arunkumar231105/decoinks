const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { cacheDel } = require('../../config/redis')

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotal(subtotal, discount_amt, tax_amt) {
  return +(Number(subtotal) - Number(discount_amt) + Number(tax_amt)).toFixed(2)
}

async function logActivity(actorId, invoiceId, action, description) {
  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'invoice', $2, $3, $4)`,
    [actorId || null, invoiceId, action, description]
  ).catch(() => {})
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function list({ page = 1, limit = 10, status = '', customer_id = '' }) {
  const offset = (page - 1) * limit
  const conditions = []
  const params = []

  if (status)      { params.push(status);      conditions.push(`i.status = $${params.length}`) }
  if (customer_id) { params.push(customer_id); conditions.push(`i.customer_id = $${params.length}`) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(`SELECT COUNT(*) FROM invoices i ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT i.*, c.name AS customer_name, o.order_number
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN orders o    ON o.id = i.order_id
     ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT i.*, c.name AS customer_name, o.order_number
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN orders o    ON o.id = i.order_id
     WHERE i.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  return rows[0]
}

async function create({ order_id, customer_id, issue_date, due_date,
                        subtotal = 0, discount_amt = 0, tax_amt = 0,
                        notes, created_by }) {
  const invoice_number = await getNextNumber('INV', 'invoices', 'invoice_number')

  // When linking to an order, override totals with the order's values
  let resolvedSubtotal    = Number(subtotal)
  let resolvedDiscountAmt = Number(discount_amt)
  let resolvedTaxAmt      = Number(tax_amt)
  let resolvedCustomerId  = customer_id || null

  if (order_id) {
    const { rows: orderRows } = await query(
      `SELECT subtotal, discount_amt, tax_amt, total, customer_id
       FROM orders WHERE id = $1 AND deleted_at IS NULL`,
      [order_id]
    )
    if (!orderRows[0]) throw Object.assign(new Error('Linked order not found'), { statusCode: 404 })
    const o = orderRows[0]
    resolvedSubtotal    = Number(o.subtotal)
    resolvedDiscountAmt = Number(o.discount_amt)
    resolvedTaxAmt      = Number(o.tax_amt)
    if (!resolvedCustomerId) resolvedCustomerId = o.customer_id
  }

  const total       = calcTotal(resolvedSubtotal, resolvedDiscountAmt, resolvedTaxAmt)
  const balance_due = total   // no payment recorded yet

  const { rows } = await query(
    `INSERT INTO invoices
       (invoice_number, order_id, customer_id, issue_date, due_date,
        subtotal, discount_amt, tax_amt, total, amount_paid, balance_due,
        notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      invoice_number,
      order_id || null, resolvedCustomerId,
      issue_date || new Date().toISOString().split('T')[0],
      due_date || null,
      resolvedSubtotal, resolvedDiscountAmt, resolvedTaxAmt,
      total, 0, balance_due,
      notes || null, created_by,
    ]
  )
  await cacheDel('dashboard:stats')
  return rows[0]
}

async function update(id, fields) {
  const allowed = ['customer_id', 'issue_date', 'due_date', 'subtotal', 'discount_amt', 'tax_amt', 'notes']
  const sets = []
  const params = []

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })

  // Recalculate total and balance_due if any financial field changed
  const financialFields = ['subtotal', 'discount_amt', 'tax_amt']
  if (financialFields.some((f) => fields[f] !== undefined)) {
    const existing = await getById(id)
    const newSubtotal     = fields.subtotal     !== undefined ? Number(fields.subtotal)     : Number(existing.subtotal)
    const newDiscountAmt  = fields.discount_amt !== undefined ? Number(fields.discount_amt) : Number(existing.discount_amt)
    const newTaxAmt       = fields.tax_amt      !== undefined ? Number(fields.tax_amt)      : Number(existing.tax_amt)
    const newTotal        = calcTotal(newSubtotal, newDiscountAmt, newTaxAmt)
    const newBalanceDue   = +(Math.max(0, newTotal - Number(existing.amount_paid))).toFixed(2)

    params.push(newTotal);     sets.push(`total = $${params.length}`)
    params.push(newBalanceDue);sets.push(`balance_due = $${params.length}`)
  }

  params.push(id)
  const { rows } = await query(
    `UPDATE invoices SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  return rows[0]
}

async function updateStatus(id, status, actorId) {
  const { rows } = await query(
    `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  await logActivity(actorId, id, 'status_changed',
    `Invoice ${rows[0].invoice_number} status changed to ${status}`)
  return rows[0]
}

async function recordPayment(id, amount_paid, actorId) {
  const inv = await getById(id)

  // Prevent payment on voided invoices
  if (inv.status === 'Void') {
    throw Object.assign(new Error('Cannot record payment on a voided invoice'), { statusCode: 409 })
  }

  const total_paid  = +Number(amount_paid).toFixed(2)
  const balance_due = +(Math.max(0, Number(inv.total) - total_paid)).toFixed(2)
  const newStatus   = balance_due <= 0 ? 'Paid' : (inv.status === 'Draft' ? 'Sent' : inv.status)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE invoices
       SET amount_paid = $1, balance_due = $2, status = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [total_paid, balance_due, newStatus, id]
    )

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description, metadata)
       VALUES ($1, 'invoice', $2, 'payment_recorded', $3, $4)`,
      [
        actorId || null, id,
        `Payment of $${total_paid.toFixed(2)} recorded on invoice ${inv.invoice_number}` +
          (balance_due > 0 ? ` — $${balance_due.toFixed(2)} still outstanding` : ' — fully paid'),
        JSON.stringify({ amount_paid: total_paid, balance_due, previous_status: inv.status, new_status: newStatus }),
      ]
    )

    await client.query('COMMIT')
    await cacheDel('dashboard:stats')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Invoices have no deleted_at column — voiding is the soft-delete pattern for financial records
async function remove(id, actorId) {
  const { rows } = await query(
    `UPDATE invoices SET status = 'Void', updated_at = NOW()
     WHERE id = $1 AND status <> 'Void'
     RETURNING *`,
    [id]
  )
  if (!rows[0]) {
    // Check if it exists at all vs already voided
    const { rows: exists } = await query(`SELECT id, status FROM invoices WHERE id = $1`, [id])
    if (!exists[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    throw Object.assign(new Error('Invoice is already voided'), { statusCode: 409 })
  }
  await logActivity(actorId, id, 'voided', `Invoice ${rows[0].invoice_number} voided`)
}

module.exports = { list, getById, create, update, updateStatus, recordPayment, remove }
