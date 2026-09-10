#!/usr/bin/env node
'use strict'

/**
 * The owner's "haan" to the four items that close most of the gap between
 * Order Value and Payments. One transaction; every record is re-identified by
 * what it is, not by a number — renumbering has moved several since they were
 * first reported.
 *
 *  1. Robert Farrar's duplicates. PAY-2026-0069 ($534.25) and PAY-2026-0116
 *     ($45.25) repeat money already on ORD-2026-0073 and ORD-2026-0118 through
 *     real payments with processor fees. PAY-2026-0134 ($105.75) and
 *     PAY-2026-0135 ($232.25) were invented by the two code paths that used to
 *     write payment rows; the real money is PAY-2026-0121 ($338, $10.11 fee),
 *     which is spread across both jobs through payment_allocations.
 *  2. Robert Farrar's 9 September job: $175, paid as PAY-2026-0156. The chat
 *     gives 54 pieces plus 8 missing pieces made good, and the total — not a
 *     per-piece price or a shipping figure — so the charge sits on one line and
 *     the replacements on another at $0.
 *  3. Mary Shirley: 9 transfers at $30 plus $12 shipping = $42 (PAY-2026-0155).
 *  4. Ricardo Malia's 1 September job was $90, not $85: 2nd-day air added $5 of
 *     shipping, and the customer paid once, $90 (PAY-2026-0123). The $85 row
 *     (PAY-2026-0126) matched the order as first raised and goes.
 *
 * Every deleted payment is copied into zz_deleted_payments_backup first.
 * Every line multiplies out to its amount — the CRM's lead backfill rewrites
 * order totals from qty x unit_price every two minutes.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = n => Number(Number(n).toFixed(2))

const FARRAR = 'CUST-2026-0051'
const RICARDO = 'CUST-2026-0045'
const MARY = 'CUST-2026-0116'

const DELETE = [
  { payment: 'PAY-2026-0069', amount: 534.25, customer: FARRAR, why: 'repeats PAY-2026-0072 on ORD-2026-0073' },
  { payment: 'PAY-2026-0116', amount: 45.25,  customer: FARRAR, why: 'repeats PAY-2026-0115 on ORD-2026-0118' },
  { payment: 'PAY-2026-0134', amount: 105.75, customer: FARRAR, note: 'Payment recorded from sales order',
    why: 'invented; the real money is PAY-2026-0121' },
  { payment: 'PAY-2026-0135', amount: 232.25, customer: FARRAR, note: 'Full payment recorded when invoice was created',
    why: 'invented; the real money is PAY-2026-0121' },
  { payment: 'PAY-2026-0126', amount: 85.00,  customer: RICARDO, why: 'the job was paid once, $90 — PAY-2026-0123' },
]

const NEW_JOBS = [
  {
    who: FARRAR, date: '2026-09-09', payment: 'PAY-2026-0156',
    parcel: '1Z24C3140204904202',
    note: '54 pcs: Betty Sexy and Wild 20, Betty SassyMercedes 16, Betty Sassy Rolls 16, Jamaica 15 2. ' +
          'Plus 8 missing pcs made good: Bass Reeves 4, Prince Purple One 4. Shipped 9 Sep UPS. ' +
          'Chat gives the $175 total only, so no per-piece or shipping split is written.',
    items: [
      { artwork: 'DTF transfers - 54 pcs, 4 designs', qty: 1, unit: 175 },
      // Kept under 60 characters: quotation_items copies a line's description
      // into product_type, which is VARCHAR(60), and the longer wording failed
      // the whole transaction.
      { artwork: 'Replacement pcs - Bass Reeves 4, Prince Purple One 4', qty: 8, unit: 0 },
    ],
    shipping: 0,
  },
  {
    who: MARY, date: '2026-09-10', payment: 'PAY-2026-0155',
    note: '9 transfers at the size agreed in chat 10 Sep — $30 plus $12 shipping.',
    items: [{ artwork: 'DTF transfers - 9 pcs', qty: 1, unit: 30 }],
    shipping: 12,
  },
]

async function nextNumber(client, table, column, prefix) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${column}, '-', 3), '')::INT), 0) + 1 AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(4, '0')}`
}

async function invoiceNumber(client, name) {
  const parts = String(name).trim().split(/\s+/)
  const prefix = ((parts[0]?.[0] ?? '') + (parts[parts.length - 1] ?? '').slice(0, 2)).toUpperCase()
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(invoice_number, '-', 2), '')::INT), 0) + 1 AS n
       FROM invoices WHERE invoice_number ~ '^[A-Z]+-[0-9]+$'`)
  return `${prefix}-${String(rows[0].n).padStart(4, '0')}`
}

async function payment(client, number) {
  const { rows } = await client.query(
    `SELECT p.*, c.customer_number FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.payment_number = $1`, [number])
  if (!rows[0]) throw new Error(`${number} not found`)
  return rows[0]
}

async function order(client, number) {
  const { rows } = await client.query(
    `SELECT o.*, c.customer_number FROM orders o
       JOIN customers c ON c.id = o.customer_id
      WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [number])
  if (!rows[0]) throw new Error(`${number} not found`)
  return rows[0]
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // -- 1a. The five payments to remove, each checked for being what it is --
    console.log('1. Payments removed (copied to zz_deleted_payments_backup first):')
    for (const d of DELETE) {
      const p = await payment(client, d.payment)
      const problems = []
      if (money(p.amount) !== d.amount) problems.push(`amount ${p.amount}`)
      if (p.customer_number !== d.customer) problems.push(`customer ${p.customer_number}`)
      if (Number(p.fee_amount) !== 0) problems.push(`carries a fee of ${p.fee_amount}`)
      if (String(p.transaction_id ?? '').trim()) problems.push('carries a transaction id')
      if (d.note && p.notes !== d.note) problems.push(`note is "${p.notes}"`)
      if (problems.length) throw new Error(`${d.payment} is not what it was: ${problems.join(', ')} — refusing`)
      console.log(`   ${d.payment}  $${d.amount.toFixed(2)}  — ${d.why}`)
      if (APPLY) {
        await client.query(
          `INSERT INTO zz_deleted_payments_backup
             (id, invoice_id, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
              payment_date, payment_number, customer_id, order_id, customer_name, status, updated_at,
              received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
              sender_account_last4, sender_reference, fee_amount, net_amount, transaction_id, deleted_at_backup)
           SELECT id, invoice_id, amount, payment_method, reference_no, paid_at, recorded_by, notes, created_at,
                  payment_date, payment_number, customer_id, order_id, customer_name, status, updated_at,
                  received_from_name, received_into_account_id, sender_bank_name, sender_account_name,
                  sender_account_last4, sender_reference, fee_amount, net_amount, transaction_id, NOW()
             FROM payments WHERE id = $1`, [p.id])
        await client.query('DELETE FROM payments WHERE id = $1', [p.id])
      }
    }

    // -- 1b. Farrar's real $338 across the two jobs it paid for --
    const real = await payment(client, 'PAY-2026-0121')
    const o130 = await order(client, 'ORD-2026-0130')
    const o131 = await order(client, 'ORD-2026-0131')
    for (const o of [o130, o131]) {
      if (o.customer_number !== FARRAR) throw new Error(`${o.order_number} is not Robert Farrar's — refusing`)
    }
    const pair = money(Number(o130.total) + Number(o131.total))
    if (pair !== money(real.amount)) {
      throw new Error(`ORD-2026-0130 + ORD-2026-0131 = ${pair}, not ${real.amount} — refusing`)
    }
    if (real.order_id) throw new Error('PAY-2026-0121 is already on an order — refusing')
    console.log(`\n   PAY-2026-0121 $338.00 -> ORD-2026-0130 $${o130.total} + ORD-2026-0131 $${o131.total}`)
    if (APPLY) {
      await client.query(
        'UPDATE payments SET order_id = $2, invoice_id = $3, updated_at = NOW() WHERE id = $1',
        [real.id, o130.id, o130.invoice_id])
      for (const o of [o130, o131]) {
        await client.query(
          `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
           VALUES ($1,$2,$3,$4,'One payment for two jobs — designs $286, two shipments at $26')
           ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
          [real.id, o.id, o.invoice_id, o.total])
      }
    }

    // -- 4. Ricardo's 1 September job at $90 --
    const r = await order(client, 'ORD-2026-0125')
    const r90 = await payment(client, 'PAY-2026-0123')
    if (r.customer_number !== RICARDO) throw new Error("ORD-2026-0125 is not Ricardo Malia's — refusing")
    if (money(r.total) !== 85 || money(r.shipping_charges) !== 15) {
      throw new Error(`ORD-2026-0125 is ${r.total} with ${r.shipping_charges} shipping, not 85 / 15 — refusing`)
    }
    if (money(r90.amount) !== 90 || r90.customer_number !== RICARDO || r90.order_id) {
      throw new Error('PAY-2026-0123 is not a loose $90 Ricardo payment — refusing')
    }
    console.log('\n4. ORD-2026-0125: shipping $15 -> $20 (2nd-day air), total $85 -> $90, PAY-2026-0123 $90 on it')
    if (APPLY) {
      await client.query(
        `UPDATE orders SET shipping_charges = 20, total = 90, amount_paid = 90, payment_status = 'Paid', updated_at = NOW()
          WHERE id = $1`, [r.id])
      if (r.invoice_id) {
        await client.query(
          'UPDATE invoices SET shipping_charges = 20, total = 90, updated_at = NOW() WHERE id = $1', [r.invoice_id])
      }
      await client.query(
        'UPDATE payments SET order_id = $2, invoice_id = $3, updated_at = NOW() WHERE id = $1',
        [r90.id, r.id, r.invoice_id])
    }

    // -- 2 & 3. The two jobs with money and no sales order --
    for (const job of NEW_JOBS) {
      const { rows: cust } = await client.query(
        'SELECT id, name FROM customers WHERE customer_number = $1 AND deleted_at IS NULL', [job.who])
      if (!cust[0]) throw new Error(`${job.who} not found`)
      const name = cust[0].name.replace(/\s+/g, ' ').trim()
      const p = await payment(client, job.payment)
      const subtotal = money(job.items.reduce((s, i) => s + i.qty * i.unit, 0))
      const total = money(subtotal + job.shipping)
      if (p.customer_number !== job.who) throw new Error(`${job.payment} is not ${name}'s — refusing`)
      if (money(p.amount) !== total) throw new Error(`${job.payment} is ${p.amount}, the job is ${total} — refusing`)
      if (p.order_id) throw new Error(`${job.payment} is already on an order — refusing`)

      console.log(`\n${job.who === FARRAR ? '2' : '3'}. ${name}  ${job.date}  goods $${subtotal.toFixed(2)} + shipping $${job.shipping.toFixed(2)} = $${total.toFixed(2)}  (${job.payment})`)
      for (const i of job.items) console.log(`      ${i.qty} x ${i.artwork} @ $${i.unit}`)

      if (!APPLY) continue

      const orderNumber = await nextNumber(client, 'orders', 'order_number', 'ORD')
      const { rows: ord } = await client.query(
        `INSERT INTO orders (order_number, customer_id, order_type, order_date, entry_date, due_date,
                             subtotal, shipping_charges, total, amount_paid, payment_status,
                             status, payment_method, currency, notes, created_at, updated_at)
         VALUES ($1,$2,'dtf'::order_type,$3::date,$3::date,$3::date,$4,$5,$6,$6,'Paid',
                 'Confirmed',$7,'USD',$8,NOW(),NOW()) RETURNING id`,
        [orderNumber, cust[0].id, job.date, subtotal, job.shipping, total, p.payment_method, job.note])
      const orderId = ord[0].id
      for (const [n, i] of job.items.entries()) {
        await client.query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, qty, unit_price, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`, [orderId, i.artwork, i.qty, i.unit, money(i.qty * i.unit), n])
      }

      const invNumber = await invoiceNumber(client, name)
      const { rows: inv } = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, customer_name, order_id, issue_date, due_date,
                               subtotal, shipping_charges, total, amount_paid, balance_due,
                               status, invoice_stage, payment_method, currency, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$5::date,$6,$7,$8,$8,0,'Paid','Sent',$9,'USD',$10,NOW(),NOW()) RETURNING id`,
        [invNumber, cust[0].id, name, orderId, job.date, subtotal, job.shipping, total, p.payment_method,
         `Raised from ${orderNumber}`])
      const invoiceId = inv[0].id
      for (const [n, i] of job.items.entries()) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`, [invoiceId, i.artwork, i.qty, i.unit, money(i.qty * i.unit), n])
      }

      const quoteNumber = await nextNumber(client, 'quotations', 'quote_number', 'Q')
      const { rows: q } = await client.query(
        `INSERT INTO quotations (quote_number, customer_id, customer_name, order_type, entry_date,
                                 subtotal, estimated_shipping, total, status, notes, created_at, updated_at)
         VALUES ($1,$2,$3,'dtf'::order_type,$4::date,$5,$6,$7,'Approved',$8,$4::date,NOW()) RETURNING id`,
        [quoteNumber, cust[0].id, name, job.date, subtotal, job.shipping, total, `Raised from ${orderNumber}`])
      for (const [n, i] of job.items.entries()) {
        await client.query(
          `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`, [q[0].id, i.artwork, i.qty, i.unit, money(i.qty * i.unit), n])
      }

      await client.query('UPDATE orders SET invoice_id = $2, quotation_id = $3 WHERE id = $1', [orderId, invoiceId, q[0].id])
      await client.query('UPDATE invoices SET quote_id = $2 WHERE id = $1', [invoiceId, q[0].id])
      await client.query(
        'UPDATE payments SET order_id = $2, invoice_id = $3, updated_at = NOW() WHERE id = $1', [p.id, orderId, invoiceId])

      let parcelNote = ''
      if (job.parcel) {
        const { rows: sh } = await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW()
            WHERE tracking_number = $1 AND order_id IS NULL AND deleted_at IS NULL
          RETURNING shipment_number`, [job.parcel, orderId])
        parcelNote = sh[0] ? `  parcel ${sh[0].shipment_number}` : '  (parcel not loose — left where it is)'
      }
      console.log(`      -> ${quoteNumber}  ${invNumber}  ${orderNumber}${parcelNote}`)
    }

    if (APPLY) { await client.query('COMMIT'); console.log('\nWritten.') }
    else { await client.query('ROLLBACK'); console.log('\nNothing written. Re-run with --apply.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
