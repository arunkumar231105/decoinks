// Several received payments linked to one invoice, and to its sales order, at once.
//
// A customer often pays one job in two or three goes. Staff pick those payments
// together from the invoice (Multiple Payments); each one then carries the
// invoice's id and, when the invoice has its sales order, the order's id — and
// the order raised later from the invoice takes them all.
//
// The rule the owner set: the payments on the invoice, together, equal its total
// — and its sales order's total — to the cent. Not more, not less. Only links
// change here; no payment's amount, method or date is written.
const db = require('../../config/db')

const CENTS = 0.01
const money = n => `$${Number(n).toFixed(2)}`
const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode })

async function linkPayments(invoiceId, paymentIds, actorId = null) {
  const ids = [...new Set((paymentIds || []).filter(Boolean))]
  if (!ids.length) throw fail('Choose at least one payment.')

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows: invRows } = await client.query(
      `SELECT id, invoice_number, total, customer_id, order_id, status, deleted_at
         FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId])
    const invoice = invRows[0]
    if (!invoice || invoice.deleted_at) throw fail('Invoice not found', 404)
    if (invoice.status === 'Void') throw fail(`${invoice.invoice_number} is void; payments cannot be linked to it.`)

    const { rows: ordRows } = await client.query(
      `SELECT id, order_number, total FROM orders
        WHERE deleted_at IS NULL AND (id = $1 OR invoice_id = $2)
        ORDER BY (id = $1) DESC, created_at LIMIT 1 FOR UPDATE`, [invoice.order_id, invoice.id])
    const order = ordRows[0] || null

    const { rows: pays } = await client.query(
      `SELECT p.id, p.payment_number, p.amount, p.status, p.invoice_id, p.order_id, p.customer_id,
              p.transaction_id, i.invoice_number AS on_invoice, o.order_number AS on_order,
              EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id) AS allocated
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.id = ANY($1::uuid[])
        ORDER BY p.payment_number
          FOR UPDATE OF p`, [ids])
    if (pays.length !== ids.length) throw fail('One of the chosen payments no longer exists.')

    for (const p of pays) {
      if (!['completed', 'received'].includes(String(p.status).toLowerCase())) {
        throw fail(`${p.payment_number} is ${p.status}, not received money.`)
      }
      if (p.invoice_id && p.invoice_id !== invoice.id) {
        throw fail(`${p.payment_number} is already on invoice ${p.on_invoice}.`, 409)
      }
      if (p.order_id && p.order_id !== order?.id) {
        throw fail(`${p.payment_number} already pays sales order ${p.on_order}.`, 409)
      }
      if (p.customer_id && invoice.customer_id && p.customer_id !== invoice.customer_id) {
        throw fail(`${p.payment_number} belongs to another customer.`, 409)
      }
      if (p.allocated) throw fail(`${p.payment_number} is split across orders by allocation; link it from the payment.`, 409)
    }
    const seenTxn = new Map()
    for (const p of pays) {
      const txn = String(p.transaction_id || '').trim()
      if (!txn) continue
      if (seenTxn.has(txn)) throw fail(`${seenTxn.get(txn)} and ${p.payment_number} are the same transaction — the same money entered twice.`)
      seenTxn.set(txn, p.payment_number)
    }

    // Everything that will pay this invoice: what it already holds, and the new.
    const { rows: held } = await client.query(
      `SELECT id, payment_number, amount FROM payments WHERE invoice_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [invoice.id, ids])
    const together = +[...held, ...pays].reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2)
    const invoiceTotal = +Number(invoice.total).toFixed(2)
    const numbers = [...held, ...pays].map(p => p.payment_number).join(' + ')

    if (Math.abs(together - invoiceTotal) > CENTS) {
      const gap = +(invoiceTotal - together).toFixed(2)
      throw fail(
        `${numbers} add up to ${money(together)}, but ${invoice.invoice_number} is ${money(invoiceTotal)} — ` +
        `${gap > 0 ? `${money(gap)} short` : `${money(-gap)} over`}. The payments must equal the total exactly.`)
    }
    if (order && Math.abs(together - Number(order.total)) > CENTS) {
      throw fail(
        `The payments equal ${invoice.invoice_number} (${money(invoiceTotal)}), but its sales order ${order.order_number} ` +
        `is ${money(order.total)}. Make the invoice and the sales order agree first.`)
    }

    await client.query(
      `UPDATE payments
          SET invoice_id  = $1,
              order_id    = COALESCE(order_id, $2),
              customer_id = COALESCE(customer_id, $3),
              updated_at  = NOW()
        WHERE id = ANY($4::uuid[])`,
      [invoice.id, order?.id || null, invoice.customer_id, ids])
    // The ones already on the invoice reach its order too.
    if (order) {
      await client.query(
        `UPDATE payments SET order_id = $1, updated_at = NOW() WHERE invoice_id = $2 AND order_id IS NULL`,
        [order.id, invoice.id])
    }

    const recorder = require('../stripe/stripe.recorder')
    const settled = await recorder.reconcileInvoice(client, invoice.id)
    if (order) await recorder.reconcileOrder(client, order.id)

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'invoice', $2, 'payments_linked', $3)`,
      [actorId, invoice.id,
        `${pays.map(p => p.payment_number).join(', ')} linked to ${invoice.invoice_number}` +
        `${order ? ` and ${order.order_number}` : ''} (${money(together)} = total)`])

    await client.query('COMMIT')
    return {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      order_number: order?.order_number || null,
      status: settled?.status,
      linked: pays.map(p => p.payment_number),
      total: together,
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // The database's own guard (migration 146) speaks as a check violation.
    if (err.code === '23514') err.statusCode = 422
    throw err
  } finally {
    client.release()
  }
}

module.exports = { linkPayments }
