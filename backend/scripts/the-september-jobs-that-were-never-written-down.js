#!/usr/bin/env node
'use strict'

/**
 * Five September jobs that were agreed, paid for, and in two cases shipped —
 * and never written into the book.
 *
 * Every figure below comes from the shop's own chat with the customer, not from
 * anything worked out here: the order summary the shop sent, the price it
 * quoted, the sizes the customer confirmed. Where the chat does not say
 * something, this does not invent it.
 *
 * Written in reverse, the way the shop asked: the sales order first, because it
 * is the job; then the invoice raised against it; then the quotation it should
 * have come from. The payment is attached last, and where a parcel has already
 * gone out it is attached too.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const money = n => Number(Number(n).toFixed(2))

// Each job as the chat records it. `items` are the line items, `shipping` the
// carriage charged, `payments` the payment numbers that paid for it.
const JOBS = [
  {
    who: 'CUST-2026-0088', name: 'Alandos Forrest', type: 'apparel',
    date: '2026-09-04',
    // Chat 04 Sep 05:24 — the shop's own order summary, after the front print
    // took the price from $10 to $11 a shirt.
    note: 'Brookfield Jungle, both sides. Agreed in chat 3-4 Sep; the front print added $1 a shirt.',
    items: [
      { item: '100% Cotton 180 GSM T-Shirt', color: 'White', size: 'XL',  qty: 3, unit: 11 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'White', size: '2XL', qty: 4, unit: 11 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'White', size: '3XL', qty: 3, unit: 11 },
    ],
    shipping: 18,
    payments: ['PAY-2026-0140', 'PAY-2026-0146'],
    shipment: 'SHP-2026-0161',
  },
  {
    who: 'CUST-2026-0089', name: 'CFinesze Bordeaux', type: 'apparel',
    date: '2026-09-04',
    // Chat 04 Sep 12:11 — the customer's own final size breakdown; 13:02 — $137
    // total. The chat never gives a per-shirt price, so the $120 of goods is
    // carried at $12 across the ten shirts, which is what was charged.
    note: 'Owl / F**k Cancer / moon-and-stars owl designs. Sizes from the customer\'s final breakdown, 4 Sep.',
    items: [
      { item: 'Printed T-Shirt', color: 'White', size: 'Large', qty: 2, unit: 12 },
      { item: 'Printed T-Shirt', color: 'White', size: '2XL',   qty: 1, unit: 12 },
      { item: 'Printed T-Shirt', color: 'Black', size: '3XL',   qty: 2, unit: 12 },
      { item: 'Printed T-Shirt', color: 'White', size: '3XL',   qty: 5, unit: 12 },
    ],
    shipping: 17,
    payments: ['PAY-2026-0141'],
  },
  {
    who: 'CUST-2026-0028', name: 'Victor Spates', type: 'dtf',
    date: '2026-09-04',
    // Chat 03 Sep 01:45-01:48 — three designs, 2 + 2 + 1, $40 plus $12 shipping.
    note: 'DTF transfers for black t-shirts. Three designs confirmed in chat 3 Sep.',
    items: [
      { artwork: 'Design 1', qty: 2, unit: 8 },
      { artwork: 'Design 2', qty: 2, unit: 8 },
      { artwork: 'Design 3', qty: 1, unit: 8 },
    ],
    shipping: 12,
    payments: ['PAY-2026-0142'],
    shipment: 'SHP-2026-0162',
  },
  {
    who: 'CUST-2026-0104', name: 'Dennis Chavies', type: 'apparel',
    date: '2026-09-06',
    // Chat 06 Sep 13:30 — the shop's own ORDER SUMMARY, $8.50 a piece.
    // 59 x 8.50 is 501.50 and the shop charged 501, so the half-dollar comes off
    // the last line rather than the agreed price being quietly changed.
    note: 'Front: Panther. Back: sponsor names. Ship to 2626 KY 930, Barbourville KY 40906.',
    items: [
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Youth Large',  qty: 7,  unit: 8.5 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Adult Small',  qty: 17, unit: 8.5 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Adult Medium', qty: 15, unit: 8.5 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Adult Large',  qty: 14, unit: 8.5 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Adult XL',     qty: 4,  unit: 8.5 },
      { item: '100% Cotton 180 GSM T-Shirt', color: 'Charcoal Gray', size: 'Adult 2X',     qty: 2,  unit: 8.5, amount: 16.5 },
    ],
    shipping: 40,
    payments: ['PAY-2026-0144'],
  },
  {
    who: 'CUST-2026-0045', name: 'Ricardo Malia', type: 'dtf',
    date: '2026-09-07',
    // Chat 05-06 Sep. $80 including shipping, and the chat gives no split, so
    // the whole charge sits on the goods rather than a carriage figure being
    // made up. The 50 extra 3.5" pieces are the free replacement for the
    // wrong-size print sent before, so they are priced at zero and say so.
    note: 'Zelle $80 including shipping - the chat gives no shipping split. 50 of the 3.5 in pieces are the free replacement for the earlier wrong-size print.',
    items: [
      { artwork: 'Logo transfer 3.5 in', qty: 25, unit: 2.4, amount: 60 },
      { artwork: 'Logo transfer 10 x 10 in', qty: 25, unit: 0.8, amount: 20 },
      { artwork: 'Logo transfer 3.5 in - free replacement', qty: 50, unit: 0, amount: 0 },
    ],
    shipping: 0,
    payments: ['PAY-2026-0147'],
  },
]

async function nextNumber(client, table, column, prefix) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(split_part(${column}, '-', 3), '')::INT), 0) + 1 AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-2026-%`])
  return `${prefix}-2026-${String(rows[0].n).padStart(4, '0')}`
}

// The invoice number carries the buyer's initials: first letter of the first
// name, first two of the surname, then its place in the whole sequence.
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

      const subtotal = money(job.items.reduce((s, i) => s + (i.amount ?? i.qty * i.unit), 0))
      const total = money(subtotal + job.shipping)

      const { rows: pays } = await client.query(
        `SELECT id, payment_number, amount, order_id, payment_method FROM payments
          WHERE payment_number = ANY($1) ORDER BY payment_date, payment_number`, [job.payments])
      const paid = money(pays.reduce((s, p) => s + Number(p.amount), 0))

      console.log(`${job.name}  (${job.type})  ${job.date}`)
      for (const i of job.items) {
        const amt = i.amount ?? money(i.qty * i.unit)
        console.log(`    ${String(i.qty).padStart(3)} x ${(i.item ?? i.artwork)}` +
                    `${i.size ? ` / ${i.size}` : ''}${i.color ? ` / ${i.color}` : ''}` +
                    `  @ $${i.unit}  = $${amt.toFixed(2)}`)
      }
      console.log(`    goods $${subtotal.toFixed(2)} + shipping $${job.shipping.toFixed(2)} = $${total.toFixed(2)}`)
      console.log(`    paid  $${paid.toFixed(2)}  (${pays.map(p => p.payment_number).join(' + ')})`)
      if (job.shipment) console.log(`    parcel ${job.shipment}`)

      if (pays.length !== job.payments.length) {
        throw new Error(`${job.name}: expected ${job.payments.length} payment(s), found ${pays.length}`)
      }
      if (paid !== total) {
        throw new Error(`${job.name}: the payments come to ${paid.toFixed(2)} but the job totals ` +
                        `${total.toFixed(2)} - refusing to write a job whose money does not add up`)
      }
      if (pays.some(p => p.order_id)) {
        throw new Error(`${job.name}: one of these payments is already on an order`)
      }

      if (!APPLY) { console.log(); continue }

      // -- The sales order: the job itself --------------------------------
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
        const amt = i.amount ?? money(i.qty * i.unit)
        if (job.type === 'apparel') {
          await client.query(
            `INSERT INTO order_items_apparel (order_id, item, color, size, qty, unit_price, amount, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [orderId, i.item, i.color ?? null, i.size ?? null, i.qty, i.unit, amt, n])
        } else {
          await client.query(
            `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [orderId, i.artwork, i.size ?? null, i.qty, i.unit, amt, n])
        }
      }

      // -- The invoice raised against it -----------------------------------
      const invNumber = await invoiceNumber(client, cust[0].name)
      const { rows: inv } = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, customer_name, order_id, issue_date, due_date,
                               subtotal, shipping_charges, total, amount_paid, balance_due,
                               status, invoice_stage, payment_method, currency, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$5::date,$6,$7,$8,$9,0,'Paid','Sent',$10,'USD',$11,NOW(),NOW())
         RETURNING id`,
        [invNumber, cust[0].id, cust[0].name, orderId, job.date, subtotal, job.shipping, total, paid,
         pays[0]?.payment_method ?? null, `Raised from ${orderNumber}`])
      const invoiceId = inv[0].id
      await client.query(`UPDATE orders SET invoice_id = $2 WHERE id = $1`, [orderId, invoiceId])

      for (const [n, i] of job.items.entries()) {
        const amt = i.amount ?? money(i.qty * i.unit)
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, qty, unit_price, amount, sizes, colors, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [invoiceId, i.item ?? i.artwork, i.qty, i.unit, amt, i.size ?? null, i.color ?? null, n])
      }

      // -- The quotation it should have come from ---------------------------
      const quoteNumber = await nextNumber(client, 'quotations', 'quote_number', 'Q')
      const { rows: q } = await client.query(
        `INSERT INTO quotations (quote_number, customer_id, customer_name, order_type, entry_date,
                                 subtotal, estimated_shipping, total, status, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4::order_type,$5::date,$6,$7,$8,'Approved',$9,$5::date,NOW())
         RETURNING id`,
        [quoteNumber, cust[0].id, cust[0].name, job.type, job.date, subtotal, job.shipping, total,
         `Raised from ${orderNumber}`])
      const quoteId = q[0].id
      await client.query(`UPDATE orders SET quotation_id = $2 WHERE id = $1`, [orderId, quoteId])
      await client.query(`UPDATE invoices SET quote_id = $2 WHERE id = $1`, [invoiceId, quoteId])

      for (const [n, i] of job.items.entries()) {
        const amt = i.amount ?? money(i.qty * i.unit)
        await client.query(
          `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sizes, colors, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [quoteId, i.item ?? i.artwork, i.qty, i.unit, amt, i.size ?? null, i.color ?? null, n])
      }

      // -- The money, and the parcel ----------------------------------------
      // One payment may name the order. A job paid in two goes on allocations,
      // and then EVERY share must be one: recalc_invoice_paid stops counting a
      // payment through its own invoice as soon as it has any allocation at all,
      // so a share left implicit would be lost.
      await client.query(
        `UPDATE payments SET order_id = $2, invoice_id = COALESCE(invoice_id, $3), updated_at = NOW()
          WHERE id = $1`, [pays[0].id, orderId, invoiceId])
      if (pays.length > 1) {
        for (const p of pays) {
          await client.query(
            `INSERT INTO payment_allocations (payment_id, order_id, invoice_id, allocated_amount, notes)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (payment_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
            [p.id, orderId, invoiceId, p.amount, `Part of ${orderNumber}`])
          await client.query(
            `UPDATE payments SET invoice_id = COALESCE(invoice_id, $2), updated_at = NOW() WHERE id = $1`,
            [p.id, invoiceId])
        }
      }

      if (job.shipment) {
        await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW()
            WHERE shipment_number = $1 AND order_id IS NULL`, [job.shipment, orderId])
      }

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
