const { query, getClient } = require('../../config/db')
const { getNextNumber, getNextInvoiceNumber } = require('../../utils/counter')
const { cacheDel } = require('../../config/redis')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotal(subtotal, discount_amt) {
  return +(Number(subtotal) - Number(discount_amt)).toFixed(2)
}

async function logActivity(actorId, invoiceId, action, description) {
  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'invoice', $2, $3, $4)`,
    [actorId || null, invoiceId, action, description]
  ).catch(() => {})
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function list({ page = 1, limit = 10, status = '', customer_id = '', supplier_id = '', search = '' }) {
  const offset = (page - 1) * limit
  const conditions = []
  const params = []

  const supplierId = supplier_id
  if (status)     { params.push(status);     conditions.push(`i.status = $${params.length}`) }
  if (customer_id) { params.push(customer_id); conditions.push(`i.customer_id = $${params.length}`) }
  else if (supplierId) { params.push(supplierId); conditions.push(`i.supplier_id = $${params.length}`) }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(i.invoice_number ILIKE $${params.length} OR i.source_po_number ILIKE $${params.length} OR i.customer_name ILIKE $${params.length} OR c.name ILIKE $${params.length} OR o.order_number ILIKE $${params.length})`)
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(
    `SELECT COUNT(*) FROM invoices i
     LEFT JOIN customers c ON c.id=i.customer_id
     LEFT JOIN orders o ON o.id=i.order_id
     ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT i.*, COALESCE(c.name, s.name, i.customer_name) AS customer_display_name, o.order_number, q.quote_number
     FROM invoices i
     LEFT JOIN customers c  ON c.id = i.customer_id
     LEFT JOIN suppliers s  ON s.id = i.supplier_id
     LEFT JOIN orders o     ON o.id = i.order_id
     LEFT JOIN quotations q ON q.id = i.quote_id
     ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT i.*, COALESCE(c.name, s.name, i.customer_name) AS customer_display_name, o.order_number, q.quote_number
     FROM invoices i
     LEFT JOIN customers c  ON c.id = i.customer_id
     LEFT JOIN suppliers s  ON s.id = i.supplier_id
     LEFT JOIN orders o     ON o.id = i.order_id
     LEFT JOIN quotations q ON q.id = i.quote_id
     WHERE i.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })

  const payments = await query(
    `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at ASC`,
    [id]
  )
  const items = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, created_at`,
    [id]
  ).catch(() => ({ rows: [] }))
  return { ...rows[0], payments: payments.rows, items: items.rows }
}

async function create(fields_in) {
  const { quote_id, order_id, supplier_id, customer_id, issue_date, due_date,
          subtotal = 0, discount_amt = 0,
          notes, created_by, order_type, items } = fields_in
  const fields = fields_in

  let resolvedSubtotal    = Number(subtotal)
  let resolvedDiscountAmt = Number(discount_amt)
  let resolvedSupplierId  = supplier_id || null
  let resolvedCustomerName = fields.customer_name || null
  let resolvedCustomerId = customer_id || null
  let quoteData = null   // full quotation row, used to backfill contact fields + line items

  // Pull totals, customer identity and contact fields from the quotation
  // when converting quote → invoice (so nothing is left blank on the invoice).
  if (quote_id) {
    const { rows: qRows } = await query(
      `SELECT subtotal, discount_amt, tax_amt, total, supplier_id, customer_id, order_type, currency,
              customer_name, company_name, billing_email, contact_number,
              shipping_address, billing_address, payment_terms, payment_method
       FROM quotations WHERE id = $1`,
      [quote_id]
    )
    if (!qRows[0]) throw Object.assign(new Error('Linked quotation not found'), { statusCode: 404 })
    const q = qRows[0]
    quoteData = q
    resolvedSubtotal    = Number(q.subtotal)
    resolvedDiscountAmt = Number(q.discount_amt)
    if (!resolvedSupplierId) resolvedSupplierId = q.supplier_id
    if (!resolvedCustomerId) resolvedCustomerId = q.customer_id
    if (!resolvedCustomerName) resolvedCustomerName = q.customer_name || q.company_name
  } else if (order_id) {
    const { rows: orderRows } = await query(
      `SELECT subtotal, discount_amt, tax_amt, total, supplier_id
       FROM orders WHERE id = $1 AND deleted_at IS NULL`,
      [order_id]
    )
    if (!orderRows[0]) throw Object.assign(new Error('Linked order not found'), { statusCode: 404 })
    const o = orderRows[0]
    resolvedSubtotal    = Number(o.subtotal)
    resolvedDiscountAmt = Number(o.discount_amt)
    if (!resolvedSupplierId) resolvedSupplierId = o.supplier_id
  }

  if (resolvedCustomerId) {
    const { rows: cRows } = await query(`SELECT name, email, company_phone_number, mobile_number FROM customers WHERE id=$1 AND deleted_at IS NULL`, [resolvedCustomerId])
    if (!cRows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
    resolvedCustomerName ||= cRows[0].name
    fields.billing_email ||= cRows[0].email
    fields.contact_number ||= cRows[0].mobile_number || cRows[0].company_phone_number
  }

  // Also try to get customer name from linked supplier record if still missing
  if (!resolvedCustomerName && resolvedSupplierId) {
    const { rows: sRows } = await query(`SELECT name FROM suppliers WHERE id = $1`, [resolvedSupplierId]).catch(() => ({ rows: [] }))
    if (sRows[0]) resolvedCustomerName = sRows[0].name
  }

  const invoice_number = await getNextInvoiceNumber(resolvedCustomerName)

  const total       = calcTotal(resolvedSubtotal, resolvedDiscountAmt)
  const balance_due = total

  const { rows } = await query(
    `INSERT INTO invoices
       (invoice_number, internal_no, quote_id, order_id, supplier_id, customer_id, issue_date, due_date,
        subtotal, discount_amt, tax_amt, total, amount_paid, balance_due,
        notes, created_by,
        customer_name, billing_email, contact_number, billing_address, shipping_address,
        order_type, payment_terms, payment_method, currency, rush_services, shipping_charges)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING *`,
    [
      invoice_number,
      `INV-INT-${invoice_number}`, quote_id || null, order_id || null, resolvedSupplierId, resolvedCustomerId,
      issue_date || new Date().toISOString().split('T')[0],
      due_date || null,
      resolvedSubtotal, resolvedDiscountAmt, 0,
      total, 0, balance_due,
      notes || null, created_by,
      // Contact fields: explicit value wins, otherwise fall back to the quotation's
      resolvedCustomerName || null,
      fields.billing_email   ?? quoteData?.billing_email   ?? null,
      fields.contact_number  ?? quoteData?.contact_number  ?? null,
      fields.billing_address ?? quoteData?.billing_address ?? null,
      fields.shipping_address?? quoteData?.shipping_address?? null,
      order_type || quoteData?.order_type || null,
      fields.payment_terms  || quoteData?.payment_terms  || 'Due on Receipt',
      fields.payment_method || quoteData?.payment_method || null,
      fields.currency       || quoteData?.currency       || 'USD',
      Number(fields.rush_services) || 0,
      Number(fields.shipping_charges) || 0,
    ]
  )

  // Save line items. Explicit items win; otherwise, when converting from a
  // quotation, copy the quotation's line items so the invoice is never blank.
  if (Array.isArray(items) && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      await query(
         `INSERT INTO invoice_items
           (invoice_id, description, qty, unit_price, amount, artwork_count, sort_order,
            front_image, back_image, artwork_image, sizes, colors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          rows[0].id,
          it.description || null,
          Number(it.qty) || 1,
          Number(it.unit_price) || 0,
          Number(it.amount) || 0,
          Number(it.artwork_count) || 0,
          it.sort_order ?? i,
          it.front_image || null,
          it.back_image  || null,
          it.artwork_image || null,
          it.sizes || null,
          it.colors || null,
        ]
      )
    }
  } else if (quote_id) {
    // Copy quotation_items → invoice_items (description, qty, price, images, artwork count)
    await query(
       `INSERT INTO invoice_items
         (invoice_id, description, qty, unit_price, amount, artwork_count, sort_order,
          front_image, back_image, artwork_image, sizes, colors)
       SELECT $1, description, qty, unit_price, amount,
              COALESCE(artwork_count, 0), COALESCE(sort_order, 0),
              front_image, back_image, artwork_image, sizes, colors
       FROM quotation_items WHERE quotation_id = $2
       ORDER BY sort_order, id`,
      [rows[0].id, quote_id]
    ).catch(() => {})
  }

  if (quote_id) {
    await logPipelineEvent({
      event_type: 'invoice_created_from_quote',
      source_table: 'quotations',
      source_id: quote_id,
      target_table: 'invoices',
      target_id: rows[0].id,
      triggered_by: created_by,
    })
  }

  await cacheDel('dashboard:stats')
  return rows[0]
}

async function update(id, fields) {
  const allowed = ['supplier_id', 'issue_date', 'due_date', 'subtotal', 'discount_amt', 'notes', 'quote_id', 'customer_name', 'billing_email', 'contact_number', 'billing_address', 'shipping_address']
  const sets = []
  const params = []

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })

  const financialFields = ['subtotal', 'discount_amt']
  if (financialFields.some((f) => fields[f] !== undefined)) {
    const existing = await getById(id)

    // A voided invoice must not have its money rewritten.
    if (existing.status === 'Void') {
      throw Object.assign(new Error('Cannot edit the amounts of a voided invoice'), { statusCode: 409 })
    }

    const newSubtotal    = fields.subtotal     !== undefined ? Number(fields.subtotal)     : Number(existing.subtotal)
    const newDiscountAmt = fields.discount_amt !== undefined ? Number(fields.discount_amt) : Number(existing.discount_amt)
    const newTotal       = calcTotal(newSubtotal, newDiscountAmt)
    const amountPaid     = Number(existing.amount_paid) || 0
    const newBalanceDue  = +(Math.max(0, newTotal - amountPaid)).toFixed(2)

    // Re-derive status so it can't contradict the new balance (e.g. an invoice
    // left 'Paid' while a raised total now leaves a balance owing).
    let newStatus = existing.status
    if (existing.status !== 'Draft') {
      if (newBalanceDue <= 0 && amountPaid > 0)      newStatus = 'Paid'
      else if (amountPaid > 0)                       newStatus = 'Partially Paid'
      else if (existing.status === 'Paid')           newStatus = 'Sent'
    }

    params.push(newTotal);     sets.push(`total = $${params.length}`)
    params.push(newBalanceDue);sets.push(`balance_due = $${params.length}`)
    if (newStatus !== existing.status) {
      params.push(newStatus);  sets.push(`status = $${params.length}`)
    }
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

async function autoCreateOrder(invoiceId, invoice, actorId, clientArg) {
  // Resolve order_type from the linked quotation (if any)
  const q = clientArg || { query: (...a) => query(...a) }
  const { rows: qtRows } = await q.query(
    `SELECT q.order_type, q.id AS quote_id
     FROM invoices i
     LEFT JOIN quotations q ON q.id = i.quote_id
     WHERE i.id = $1`,
    [invoiceId]
  )
  const orderType = qtRows[0]?.order_type
  if (!orderType) return null  // no order_type available — skip auto-creation

  // Idempotency: don't create a second order for the same invoice
  const { rows: existing } = await q.query(
    `SELECT id FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [invoiceId]
  )
  if (existing[0]) return existing[0].id

  const ordNumber = await getNextNumber('ORD', 'orders', 'order_number')
  const total = +Number(invoice.total).toFixed(2)

  const { rows: ordRows } = await q.query(
    `INSERT INTO orders
       (order_number, invoice_id, supplier_id, order_type, order_date,
        subtotal, discount_amt, tax_amt, total, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      ordNumber, invoiceId, invoice.supplier_id, orderType,
      new Date().toISOString().split('T')[0],
      invoice.subtotal, invoice.discount_amt, 0, total,
      actorId,
    ]
  )
  const orderId = ordRows[0].id

  await q.query(
    `INSERT INTO pipeline_events
       (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
     VALUES ('order_created_from_invoice','invoices',$1,'orders',$2,$3,$4)`,
    [invoiceId, orderId, actorId, JSON.stringify({ invoice_number: invoice.invoice_number, order_number: ordNumber })]
  )

  return orderId
}

async function updateStatus(id, status, actor) {
  const actorId   = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  const { rows: cur } = await query(`SELECT status FROM invoices WHERE id = $1`, [id])
  if (!cur[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  if (actorUser) validateTransition('invoice', cur[0].status, status, actorUser)

  const ordNumber = status === 'Paid' ? await getNextNumber('ORD', 'orders', 'order_number') : null

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const paidAt = status === 'Paid' ? ', paid_at = COALESCE(paid_at, NOW())' : ''
    const { rows } = await client.query(
      `UPDATE invoices SET status = $1, updated_at = NOW()${paidAt} WHERE id = $2 RETURNING *`,
      [status, id]
    )
    if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    const invoice = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'invoice', $2, 'status_changed', $3)`,
      [actorId || null, id, `Invoice ${invoice.invoice_number} status changed to ${status}`]
    ).catch(() => {})

    let autoOrderId = null
    if (status === 'Paid') {
      // Resolve order_type from linked quotation
      const { rows: qtRows } = await client.query(
        `SELECT q.order_type FROM invoices i LEFT JOIN quotations q ON q.id = i.quote_id WHERE i.id = $1`,
        [id]
      )
      const orderType = qtRows[0]?.order_type

      if (orderType) {
        // Idempotency
        const { rows: existing } = await client.query(
          `SELECT id FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]
        )

        if (!existing[0]) {
          const total = +Number(invoice.total).toFixed(2)
          const { rows: ordRows } = await client.query(
            `INSERT INTO orders
               (order_number, invoice_id, supplier_id, order_type, order_date,
                subtotal, discount_amt, tax_amt, total, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id`,
            [
              ordNumber, id, invoice.supplier_id, orderType,
              new Date().toISOString().split('T')[0],
              invoice.subtotal, invoice.discount_amt, 0, total,
              actorId,
            ]
          )
          autoOrderId = ordRows[0].id

          await client.query(
            `INSERT INTO pipeline_events
               (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
             VALUES ('order_created_from_invoice','invoices',$1,'orders',$2,$3,$4)`,
            [id, autoOrderId, actorId, JSON.stringify({ invoice_number: invoice.invoice_number, order_number: ordNumber })]
          )
        } else {
          autoOrderId = existing[0].id
        }
      }

      await client.query(
        `INSERT INTO pipeline_events
           (event_type, source_table, source_id, triggered_by)
         VALUES ('invoice_paid','invoices',$1,$2)`,
        [id, actorId]
      )
    }

    await client.query('COMMIT')
    return { ...invoice, status, auto_order_id: autoOrderId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function recordPayment(id, { amount, payment_method, reference_no = null, notes = null }, actorId) {
  const inv = await getById(id)

  if (inv.status === 'Void') {
    throw Object.assign(new Error('Cannot record payment on a voided invoice'), { statusCode: 409 })
  }
  if (inv.status === 'Paid') {
    throw Object.assign(new Error('This invoice is already fully paid'), { statusCode: 409 })
  }

  // Reject overpayment: a single payment cannot exceed what is still owed.
  // Use the ledger sum (source of truth) rather than the cached amount_paid.
  const { rows: paidRows } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1`,
    [id]
  )
  const alreadyPaid = +Number(paidRows[0].paid).toFixed(2)
  const outstanding = +(Number(inv.total) - alreadyPaid).toFixed(2)
  // 0.01 tolerance for rounding; block anything meaningfully over the balance.
  if (Number(amount) > outstanding + 0.01) {
    throw Object.assign(
      new Error(`Payment of ${Number(amount).toFixed(2)} exceeds the outstanding balance of ${outstanding.toFixed(2)}`),
      { statusCode: 422 }
    )
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO payments (invoice_id, amount, payment_method, reference_no, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, amount, payment_method, reference_no, notes, actorId || null]
    )

    // Recalculate total paid from the payments table (source of truth)
    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = $1`,
      [id]
    )
    const total_paid  = +Number(sumRows[0].total_paid).toFixed(2)
    const balance_due = +(Math.max(0, Number(inv.total) - total_paid)).toFixed(2)

    let newStatus
    if (balance_due <= 0) {
      newStatus = 'Paid'
    } else if (total_paid > 0) {
      newStatus = 'Partially Paid'
    } else {
      newStatus = inv.status === 'Draft' ? 'Sent' : inv.status
    }

    const { rows } = await client.query(
      `UPDATE invoices
       SET amount_paid = $1, balance_due = $2, status = $3,
           paid_at = CASE WHEN $3 = 'Paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [total_paid, balance_due, newStatus, id]
    )

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description, metadata)
       VALUES ($1, 'invoice', $2, 'payment_recorded', $3, $4)`,
      [
        actorId || null, id,
        `Payment of $${Number(amount).toFixed(2)} recorded on invoice ${inv.invoice_number} via ${payment_method}` +
          (balance_due > 0 ? ` — $${balance_due.toFixed(2)} still outstanding` : ' — fully paid'),
        JSON.stringify({ amount, payment_method, reference_no, total_paid, balance_due, new_status: newStatus }),
      ]
    )

    await client.query('COMMIT')

    if (newStatus === 'Paid') {
      await logPipelineEvent({
        event_type: 'invoice_paid',
        source_table: 'invoices',
        source_id: id,
        triggered_by: actorId,
        metadata: { total_paid, payment_method },
      })
      // Best-effort auto-order creation (outside the payment transaction — payment must not fail due to order creation).
      // Failures are logged, not swallowed, so a broken pipeline is visible.
      autoCreateOrder(id, rows[0], actorId, null).catch((err) => {
        console.error(`[pipeline] auto-order creation failed for invoice ${inv.invoice_number} (${id}):`, err.message)
        query(
          `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
           VALUES ($1, 'invoice', $2, 'auto_order_failed', $3)`,
          [actorId || null, id, `Automatic order creation failed after payment: ${err.message}`]
        ).catch(() => {})
      })
    } else if (newStatus === 'Partially Paid') {
      await logPipelineEvent({
        event_type: 'invoice_partially_paid',
        source_table: 'invoices',
        source_id: id,
        triggered_by: actorId,
        metadata: { amount, total_paid, balance_due, payment_method },
      })
    }

    await cacheDel('dashboard:stats')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function remove(id, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: inv } = await client.query(
      `SELECT id, invoice_number FROM invoices WHERE id = $1`, [id]
    )
    if (!inv[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    // Unlink orders and delete payments before deleting invoice (RESTRICT FK)
    await client.query(`UPDATE orders SET invoice_id = NULL WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM payments WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM invoices WHERE id = $1`, [id])
    await client.query('COMMIT')
    await logActivity(actorId, id, 'deleted', `Invoice ${inv[0].invoice_number} permanently deleted`).catch(() => {})
    return { id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function convertToOrder(invoiceId, actorId, orderType) {
  if (!orderType) throw Object.assign(new Error('order_type is required (apparel, gangsheet, or dtf)'), { statusCode: 422 })

  // Idempotency: return existing order if already created from this invoice
  const { rows: existing } = await query(
    `SELECT o.*, s.name AS supplier_name FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.invoice_id = $1 ORDER BY o.created_at LIMIT 1`,
    [invoiceId]
  )
  if (existing[0]) return { order: existing[0], alreadyExisted: true }

  const orderSvc = require('../orders/orders.service')
  const order = await orderSvc.create({
    invoice_id:  invoiceId,
    order_type:  orderType,
    items:       [],
    created_by:  actorId,
  })
  return { order, alreadyExisted: false }
}

module.exports = { list, getById, create, update, updateStatus, recordPayment, remove, convertToOrder }
