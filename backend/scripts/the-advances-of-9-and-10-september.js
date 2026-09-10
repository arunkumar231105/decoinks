#!/usr/bin/env node
'use strict'

/**
 * Five payments that arrived on 9 and 10 September with no sales order behind
 * them. Each job is taken from the shop's own chat with the customer — the
 * price it quoted, the quantity agreed, the total the customer then paid —
 * and nothing is filled in that the chat does not say. Where the chat names no
 * sizes, none are written.
 *
 *   Eric Brent          6 tees at $12, $25 shipping                = $97
 *   Tim BlackDragon     16 tees at $9, $20 shipping (two addresses) = $164
 *   Johnny At TrashWorx one 22 x 60 in gang sheet at $25, $12 ship  = $37
 *   Valerie Carder      4 navy tees at $13, $15 shipping            = $67
 *   Valeria Battle      36 tees at $8, $20 shipping                 = $308
 *
 * Valeria Battle's quotation already exists (Q-2026-0155, the same $308), so it
 * is approved and used rather than a second one being raised beside it. The
 * others are written in reverse, the way the shop asked: sales order, then its
 * invoice, then the quotation it should have come from.
 *
 * Every line multiplies out to its amount. The CRM's lead backfill rewrites
 * order totals from qty x unit_price every two minutes, so an amount that does
 * not equal that product does not survive.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = n => Number(Number(n).toFixed(2))

const JOBS = [
  {
    who: 'CUST-2026-0114', type: 'apparel', date: '2026-09-10',
    // Chat 10 Sep 14:17-14:57 — "6 shirts total", "$12 per tshirt",
    // "shipping will be $25", "your total will be $97", then "Paid".
    note: '6 tees, different logos, 100% cotton 180 GSM. Agreed in chat 10 Sep.',
    items: [{ item: '100% Cotton 180 GSM T-Shirt', qty: 6, unit: 12 }],
    shipping: 25, payments: ['PAY-2026-0152'],
  },
  {
    who: 'CUST-2026-0110', type: 'apparel', date: '2026-09-09',
    // Chat 9 Sep 05:01-06:17 — "16 t-shirts at $9 each, plus $20 shipping",
    // one-side print, shipping to two addresses; "Your total is $164".
    note: '16 tees, one-side print, shipping split across two addresses. Agreed in chat 9 Sep.',
    items: [{ item: 'Printed T-Shirt (one side)', qty: 16, unit: 9 }],
    shipping: 20, payments: ['PAY-2026-0149'],
  },
  {
    who: 'CUST-2026-0111', type: 'dtf', date: '2026-09-09',
    // Chat 6 Sep 02:04-02:15 — minimum sheet 60 x 22 in at $25 plus
    // shipping, gaps filled with 10 x 11.5 in designs; "$37 including shipping".
    note: 'One 22 x 60 in gang sheet, spare space filled with ~10 x 11.5 in designs. Agreed in chat 6 Sep.',
    items: [{ artwork: 'Gang sheet 22 x 60 in', qty: 1, unit: 25 }],
    shipping: 12, payments: ['PAY-2026-0150'],
  },
  {
    who: 'CUST-2026-0084', type: 'apparel', date: '2026-09-09',
    // Chat 2 Sep — $13 a tee, $15 shipping, navy; her 2 x 4XL plus her
    // daughter's 2 x Large — "So that makes it $67 right?". 4 Sep: all four #10.
    note: '4 navy tees, #10 on the back of all four. Paid $67; bank dispute opened and cancelled 9 Sep — customer is waiting for her order number and receipt.',
    items: [
      { item: 'Printed T-Shirt', color: 'Navy', size: '4XL',   qty: 2, unit: 13 },
      { item: 'Printed T-Shirt', color: 'Navy', size: 'Large', qty: 2, unit: 13 },
    ],
    shipping: 15, payments: ['PAY-2026-0148'],
  },
  {
    who: 'CUST-2026-0113', type: 'apparel', date: '2026-09-10',
    // Chat 10 Sep 14:48-14:57 — "For DTF the price will be $308 including
    // shipping (36 T Shirts)"; "I Will Get the $308.00". The quotation the shop
    // raised says the same: 36 at $8 plus $20.
    note: '36 tees, DTF print. Quoted as Q-2026-0155.',
    quote: 'Q-2026-0155',
    items: [
      { item: '180G Adult 100% Cotton T-Shirt', qty: 15, unit: 8 },
      { item: '180G Adult 100% Cotton T-Shirt', qty: 15, unit: 8 },
      { item: '180G Adult 100% Cotton T-Shirt', qty: 5,  unit: 8 },
      { item: 'Gildan Youth T-Shirt',           qty: 1,  unit: 8 },
    ],
    shipping: 20, payments: ['PAY-2026-0153'],
  },
]

async function nextNumber(client, table, column, prefix) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${column}, '-', 3), '')::INT), 0) + 1 AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(4, '0')}`
}

// First letter of the first name, first two of the surname, then its place in
// the one sequence every invoice shares.
async function invoiceNumber(client, name) {
  const parts = String(name).trim().split(/\s+/)
  const prefix = ((parts[0]?.[0] ?? '') + (parts[parts.length - 1] ?? '').slice(0, 2)).toUpperCase()
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(invoice_number, '-', 2), '')::INT), 0) + 1 AS n
       FROM invoices WHERE invoice_number ~ '^[A-Z]+-[0-9]+$'`)
  return `${prefix}-${String(rows[0].n).padStart(4, '0')}`
}

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    for (const job of JOBS) {
      const { rows: cust } = await client.query(
        `SELECT id, name FROM customers WHERE customer_number = $1 AND deleted_at IS NULL`, [job.who])
      if (!cust[0]) throw new Error(`${job.who} not found`)
      const name = cust[0].name.replace(/\s+/g, ' ').trim()

      const lineAmount = i => money(i.qty * i.unit)
      const subtotal = money(job.items.reduce((s, i) => s + lineAmount(i), 0))
      const total = money(subtotal + job.shipping)

      const { rows: pays } = await client.query(
        `SELECT id, payment_number, amount, order_id, payment_method FROM payments
          WHERE payment_number = ANY($1) ORDER BY payment_date, payment_number`, [job.payments])
      const paid = money(pays.reduce((s, p) => s + Number(p.amount), 0))

      console.log(`${name}  (${job.type})  ${job.date}`)
      for (const i of job.items) {
        console.log(`    ${String(i.qty).padStart(3)} x ${i.item ?? i.artwork}` +
                    `${i.size ? ` / ${i.size}` : ''}${i.color ? ` / ${i.color}` : ''}` +
                    `  @ $${i.unit}  = $${lineAmount(i).toFixed(2)}`)
      }
      console.log(`    goods $${subtotal.toFixed(2)} + shipping $${job.shipping.toFixed(2)} = $${total.toFixed(2)}`)
      console.log(`    paid  $${paid.toFixed(2)}  (${pays.map(p => p.payment_number).join(' + ')})`)

      if (pays.length !== job.payments.length) throw new Error(`${name}: a payment is missing`)
      if (paid !== total) {
        throw new Error(`${name}: payments come to ${paid.toFixed(2)} but the job totals ${total.toFixed(2)} — refusing`)
      }
      if (pays.some(p => p.order_id)) throw new Error(`${name}: a payment is already on an order`)

      let existingQuote = null
      if (job.quote) {
        const { rows: q } = await client.query(
          `SELECT id, quote_number, total, customer_id FROM quotations
            WHERE quote_number = $1 AND deleted_at IS NULL`, [job.quote])
        if (!q[0]) throw new Error(`${job.quote} not found`)
        if (money(q[0].total) !== total) {
          throw new Error(`${job.quote} is $${q[0].total}, not $${total.toFixed(2)} — the quotation and the job disagree`)
        }
        if (q[0].customer_id !== cust[0].id) throw new Error(`${job.quote} belongs to another customer`)
        existingQuote = q[0]
        console.log(`    uses existing ${existingQuote.quote_number} ($${existingQuote.total})`)
      }

      if (!APPLY) { console.log(); continue }

      // -- The sales order ---------------------------------------------------
      const orderNumber = await nextNumber(client, 'orders', 'order_number', 'ORD')
      const { rows: ord } = await client.query(
        `INSERT INTO orders (order_number, customer_id, order_type, order_date, entry_date, due_date,
                             subtotal, shipping_charges, total, amount_paid, payment_status,
                             status, payment_method, currency, notes, created_at, updated_at)
         VALUES ($1,$2,$3::order_type,$4::date,$4::date,$4::date,$5,$6,$7,$8,'Paid',
                 'Confirmed',$9,'USD',$10,NOW(),NOW())
         RETURNING id`,
        [orderNumber, cust[0].id, job.type, job.date, subtotal, job.shipping, total, paid,
         pays[0]?.payment_method ?? null, job.note])
      const orderId = ord[0].id

      for (const [n, i] of job.items.entries()) {
        if (job.type === 'apparel') {
          await client.query(
            `INSERT INTO order_items_apparel (order_id, item, color, size, qty, unit_price, amount, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [orderId, i.item, i.color ?? null, i.size ?? null, i.qty, i.unit, lineAmount(i), n])
        } else {
          await client.query(
            `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [orderId, i.artwork, i.size ?? null, i.qty, i.unit, lineAmount(i), n])
        }
      }

      // -- Its invoice --------------------------------------------------------
      const invNumber = await invoiceNumber(client, name)
      const { rows: inv } = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, customer_name, order_id, quote_id,
                               issue_date, due_date, subtotal, shipping_charges, total,
                               amount_paid, balance_due, status, invoice_stage, payment_method,
                               currency, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::date,$6::date,$7,$8,$9,$10,0,'Paid','Sent',$11,'USD',$12,NOW(),NOW())
         RETURNING id`,
        [invNumber, cust[0].id, name, orderId, existingQuote?.id ?? null, job.date,
         subtotal, job.shipping, total, paid, pays[0]?.payment_method ?? null,
         `Raised from ${orderNumber}`])
      const invoiceId = inv[0].id
      await client.query(`UPDATE orders SET invoice_id = $2 WHERE id = $1`, [orderId, invoiceId])

      for (const [n, i] of job.items.entries()) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sizes, colors, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [invoiceId, i.item ?? i.artwork, i.qty, i.unit, lineAmount(i), i.size ?? null, i.color ?? null, n])
      }

      // -- The quotation: the one already raised, or the one it came from -----
      let quoteNumber
      if (existingQuote) {
        await client.query(
          `UPDATE quotations SET status = 'Approved', updated_at = NOW() WHERE id = $1`, [existingQuote.id])
        await client.query(`UPDATE orders SET quotation_id = $2 WHERE id = $1`, [orderId, existingQuote.id])
        quoteNumber = existingQuote.quote_number
      } else {
        quoteNumber = await nextNumber(client, 'quotations', 'quote_number', 'Q')
        const { rows: q } = await client.query(
          `INSERT INTO quotations (quote_number, customer_id, customer_name, order_type, entry_date,
                                   subtotal, estimated_shipping, total, status, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4::order_type,$5::date,$6,$7,$8,'Approved',$9,$5::date,NOW())
           RETURNING id`,
          [quoteNumber, cust[0].id, name, job.type, job.date, subtotal, job.shipping, total,
           `Raised from ${orderNumber}`])
        for (const [n, i] of job.items.entries()) {
          await client.query(
            `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sizes, colors, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [q[0].id, i.item ?? i.artwork, i.qty, i.unit, lineAmount(i), i.size ?? null, i.color ?? null, n])
        }
        await client.query(`UPDATE orders SET quotation_id = $2 WHERE id = $1`, [orderId, q[0].id])
        await client.query(`UPDATE invoices SET quote_id = $2 WHERE id = $1`, [invoiceId, q[0].id])
      }

      // -- The money ----------------------------------------------------------
      await client.query(
        `UPDATE payments SET order_id = $2, invoice_id = COALESCE(invoice_id, $3), updated_at = NOW()
          WHERE id = $1`, [pays[0].id, orderId, invoiceId])

      console.log(`    -> ${quoteNumber}  ${invNumber}  ${orderNumber}\n`)
    }

    if (APPLY) { await client.query('COMMIT'); console.log('Written.') }
    else { await client.query('ROLLBACK'); console.log('Nothing written. Re-run with --apply.') }
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
