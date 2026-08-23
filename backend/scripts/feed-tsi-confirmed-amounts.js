#!/usr/bin/env node
/**
 * Put the money on the TSI jobs the shop has just sent figures for.
 *
 * Eight references came in. Six can be written without guessing; two cannot,
 * and are reported instead.
 *
 * WHAT "TOTAL AMOUNT" MEANS HERE. The goods, with the shipping quoted beside
 * it — not the two added together. The sheet proves it: on four of these the
 * order already carries exactly the shipping the shop quoted ($10.00 against
 * $10.00, four times over) with nothing against the goods, which is the import
 * writing the postage and leaving the work unpriced. So the total becomes
 * goods + shipping. This is the opposite of the DIGI apparel sheet, where the
 * figure was the full payment with the shipping inside it — worth saying out
 * loud, because the two sheets look alike and mean different things.
 *
 * THE WHOLE CHAIN, NOT JUST THE ORDER. Each job has a quotation, an invoice, a
 * sales order and a purchase order, and the zero runs through the first three.
 * All three are written together so they cannot disagree, and the DTF line
 * carries the price per piece.
 *
 * TWO ARE NOT WRITTEN:
 *
 *   TSI 260731-67  "Same amount as TSI-66." TSI 260731-66 is ORD-2026-0082,
 *                  Vianelly Chichipa — a different customer, and it has no
 *                  goods amount of its own either ($0.00 against $15.00
 *                  shipping). There is nothing to copy from.
 *
 *   TSI 260815-88  The sheet says $109 + $26. The order already says $415.25 +
 *                  $45.00 = $460.25, and it is the one the shop said this
 *                  morning it was chasing. Meanwhile ORD-2026-0112, TSI
 *                  260814-86, already holds exactly $109.00 + $26.00 = $135.00.
 *                  Two references cannot both be that job, and overwriting a
 *                  $460.25 order with $135.00 on a line that may have been
 *                  copied from the row above it is not a guess worth making.
 *
 * Usage:
 *   node backend/scripts/feed-tsi-confirmed-amounts.js            (dry-run)
 *   node backend/scripts/feed-tsi-confirmed-amounts.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const money = n => `$${Number(n || 0).toFixed(2)}`
const cents = n => Math.round(Number(n || 0) * 100)

// Straight from the shop's message. goods is "Total amount", ship is "Shipping".
const SHEET = [
  { ref: '260427-06', customer: 'Dannyboy',      goods: 40,    ship: 10 },
  { ref: '260513-14', customer: 'Walby',         goods: 92.99, ship: 10 },
  { ref: '260519-16', customer: 'Tracy Machado', goods: 0,     ship: 10, note: 'the sheet says FREE' },
  { ref: '260525-17', customer: 'Walby',         goods: 93,    ship: 10 },
  { ref: '260730-64', customer: 'Robert Farrar', goods: 191,   ship: 26 },
  { ref: '260730-65', customer: 'Robert Farrar', goods: 534,   ship: 26 },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const ready = []
    const skipped = []

    for (const row of SHEET) {
      const { rows } = await client.query(`
        SELECT o.id, o.order_number, o.subtotal, o.shipping_charges, o.total, o.invoice_id,
               c.name AS customer, i.id AS invoice_id2, i.invoice_number, i.quote_id,
               q.quote_number,
               (SELECT COALESCE(SUM(qty),0) FROM order_items_dtf x WHERE x.order_id = o.id)::int AS qty,
               (SELECT count(*) FROM order_items_dtf x WHERE x.order_id = o.id)::int AS lines
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN invoices i ON i.id = o.invoice_id
          LEFT JOIN quotations q ON q.id = i.quote_id
         WHERE o.deleted_at IS NULL AND o.source_po_number ILIKE $1`, [`%${row.ref}%`])

      if (rows.length !== 1) { skipped.push({ row, why: `${rows.length} orders match that reference` }); continue }
      const o = rows[0]
      const first = row.customer.split(' ')[0].toLowerCase()
      if (!(o.customer || '').toLowerCase().includes(first)) {
        skipped.push({ row, why: `the order belongs to ${o.customer}` }); continue
      }
      const total = +(row.goods + row.ship).toFixed(2)
      if (cents(o.total) === cents(total) && cents(o.subtotal) === cents(row.goods)) {
        skipped.push({ row, why: `already reads ${money(row.goods)} + ${money(row.ship)} — nothing to change` }); continue
      }
      ready.push({ ...row, ...o, newTotal: total })
    }

    console.log(`Ready to write: ${ready.length} of ${SHEET.length}\n`)
    for (const r of ready) {
      console.log(`  TSI ${r.ref}  ${r.order_number}  ${r.customer}`)
      console.log(`      goods ${money(r.subtotal)} → ${money(r.goods)}   shipping ${money(r.shipping_charges)} → ${money(r.ship)}` +
        `   total ${money(r.total)} → ${money(r.newTotal)}`)
      console.log(`      ${r.qty} pcs → ${r.qty ? money(r.goods / r.qty) : '—'} each` +
        `   ·   ${r.quote_number || 'no quote'}, ${r.invoice_number || 'no invoice'}${r.note ? `   ·   ${r.note}` : ''}`)
    }
    if (skipped.length) {
      console.log(`\nSkipped: ${skipped.length}`)
      skipped.forEach(s => console.log(`  TSI ${s.row.ref}  ${s.row.customer} — ${s.why}`))
    }
    console.log(`\n  ${money(ready.reduce((s, r) => s + r.newTotal - Number(r.total), 0))} of value being recorded.`)

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!ready.length) { console.log('\nNothing to write.'); return }

    await client.query('BEGIN')
    for (const r of ready) {
      const unit = r.qty ? +(r.goods / r.qty).toFixed(4) : 0

      await client.query(`
        UPDATE orders SET subtotal = $2, shipping_charges = $3, total = $4,
               amount_paid = $4, payment_status = 'Paid', payment_terms = 'Advance', updated_at = NOW()
         WHERE id = $1`, [r.id, r.goods, r.ship, r.newTotal])

      if (r.lines) {
        await client.query(
          `UPDATE order_items_dtf SET unit_price = $2, amount = $3 WHERE order_id = $1`,
          [r.id, unit, r.goods])
      }

      if (r.invoice_id2) {
        await client.query(`
          UPDATE invoices SET subtotal = $2, shipping_charges = $3, total = $4,
                 amount_paid = $4, balance_due = 0, status = 'Paid'::invoice_status,
                 paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
           WHERE id = $1`, [r.invoice_id2, r.goods, r.ship, r.newTotal])
        await client.query(
          `UPDATE invoice_items SET unit_price = $2, amount = $3 WHERE invoice_id = $1`,
          [r.invoice_id2, unit, r.goods])
      }

      if (r.quote_id) {
        await client.query(`
          UPDATE quotations SET subtotal = $2, estimated_shipping = $3, total = $4, updated_at = NOW()
           WHERE id = $1`, [r.quote_id, r.goods, r.ship, r.newTotal])
        await client.query(
          `UPDATE quotation_items SET unit_price = $2, amount = $3 WHERE quotation_id = $1`,
          [r.quote_id, unit, r.goods])
      }
    }

    // ── Proof: the three documents of each job must agree ────────────────
    const problems = []
    for (const r of ready) {
      const { rows: [after] } = await client.query(`
        SELECT o.subtotal AS o_sub, o.shipping_charges AS o_ship, o.total AS o_total, o.amount_paid,
               i.subtotal AS i_sub, i.shipping_charges AS i_ship, i.total AS i_total, i.balance_due,
               q.subtotal AS q_sub, q.estimated_shipping AS q_ship, q.total AS q_total
          FROM orders o
          LEFT JOIN invoices i ON i.id = o.invoice_id
          LEFT JOIN quotations q ON q.id = i.quote_id
         WHERE o.id = $1`, [r.id])
      const want = cents(r.newTotal)
      if (cents(after.o_total) !== want) problems.push(`${r.order_number} order total ${money(after.o_total)}`)
      if (cents(after.o_sub) + cents(after.o_ship) !== want) problems.push(`${r.order_number} order parts do not add up`)
      if (cents(after.amount_paid) !== want) problems.push(`${r.order_number} amount received ${money(after.amount_paid)}`)
      if (r.invoice_id2 && cents(after.i_total) !== want) problems.push(`${r.invoice_number} invoice total ${money(after.i_total)}`)
      if (r.invoice_id2 && cents(after.balance_due) !== 0) problems.push(`${r.invoice_number} still shows a balance`)
      if (r.quote_id && cents(after.q_total) !== want) problems.push(`${r.quote_number} quote total ${money(after.q_total)}`)
    }

    if (problems.length) {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written:')
      problems.forEach(p => console.log(`  ✗ ${p}`))
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nWrote ${ready.length} job(s) — quotation, invoice and sales order together.`)
    for (const r of ready) {
      console.log(`  ${r.order_number}  ${money(r.goods)} + ${money(r.ship)} = ${money(r.newTotal)}` +
        `   ${r.quote_number}, ${r.invoice_number}   ✓`)
    }
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
