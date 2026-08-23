#!/usr/bin/env node
/**
 * Put the money on the DIGI apparel orders that came in at zero.
 *
 * The decoinks_digi_apparel_2026 import created fifteen orders with a total of
 * $0.00, no invoice, and a single aggregate line — "DIGI apparel — 6 items" —
 * priced at nothing. The shop's confirmed-orders sheet has what was actually
 * paid for seven of those jobs, and this writes it back.
 *
 * HOW EACH ROW IS MATCHED. By order number, named explicitly below, and then
 * checked against the customer name and the quantity on the order before
 * anything is written. A row whose quantity does not agree is not guessed at —
 * it is reported and skipped. The one deliberate exception is Alex Cabrera,
 * whose sheet counts 102 items (2 sample shirts plus 100 neck labels) while the
 * order only ever carried the 2 shirts; the money is for the whole job either
 * way and there is only one order for that customer.
 *
 * WHAT "FULL PAYMENT" MEANS. It is the total including shipping, not on top of
 * it. The sheet proves it on Trina Nez: quoted $156, shipping $18, full payment
 * $174. So the order's subtotal becomes payment − shipping.
 *
 * NO PAYMENT RECEIPTS ARE CREATED. The sheet names the platform — PayPal,
 * Zelle, Cash App — but not the day the money cleared or its reference, and a
 * receipt invents a transaction that nobody can check. The platform is recorded
 * on the order and in its notes instead. This is the same line drawn for the
 * thirty-eight invoices settled without a receipt.
 *
 * CHRISTINE CALHOUN IS NOT HERE. Her sheet row is one job of eight pieces for
 * $127; the import made it two orders, six and two. Splitting $127 between them
 * needs the price of a hoodie against a T-shirt, which the sheet does not give.
 * Left for the owner.
 *
 * Usage:
 *   node backend/scripts/feed-digi-confirmed-payments.js            (dry-run)
 *   node backend/scripts/feed-digi-confirmed-payments.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const money = n => `$${Number(n || 0).toFixed(2)}`
const cents = n => Math.round(Number(n || 0) * 100)

// Straight from the shop's confirmed-orders sheet.
const SHEET = [
  { order: 'ORD-2026-0128', customer: 'Enrique Vasquez', qty: 6, shipping: 0, payment: 70,
    platform: 'PayPal', method: 'paypal',
    item: 'Custom T-Shirts', sizes: '3 Large; 3 Medium', colour: 'Not clearly stated',
    design: 'Small front logo + large back print with phone number' },

  { order: 'ORD-2026-0136', customer: 'Trina Nez', qty: 12, shipping: 18, payment: 174,
    platform: 'Zelle', method: 'zelle',
    item: 'Custom T-Shirts', sizes: '2 Large; 2 2XL; 4 3XL; 4 4XL', colour: 'Navy Blue',
    design: 'Campaign design: "VOTE William Nez, Sr. District 14 Council Delegate"' },

  { order: 'ORD-2026-0127', customer: 'Alex M Cabrera', qty: 2, sheetQty: 102, shipping: 22, payment: 80,
    platform: 'PayPal', method: 'paypal',
    item: '2 Sample T-Shirts + 100 DTF Neck Labels',
    sizes: '2 XL sample shirts; 50 L labels; 50 XL labels', colour: 'Black shirts',
    design: '1 XL DTF back-print sample + 1 XL DTG back-print sample; 100 DTF neck-label transfers',
    note: 'The sheet counts 102 pieces — 2 sample shirts and 100 neck labels. The order carries only the 2 shirts; the payment covers the whole job.' },

  { order: 'ORD-2026-0131', customer: 'BAR NEL', qty: 10, shipping: 15, payment: 115,
    platform: 'Cash App', method: 'cashapp',
    item: 'Custom T-Shirts', sizes: '10 XL', colour: 'Mixed colors requested: Red, Blue, Orange, Yellow, Black',
    design: '5 flaming-basketball design on front; 5 ball-in-net design on back; IG @smooth1productions included' },

  { order: 'ORD-2026-0133', customer: 'George Rogers', qty: 6, shipping: 15, payment: 87,
    platform: 'Card via Decoinks website', method: 'other',
    item: 'Custom T-Shirts', sizes: '6 XL', colour: 'Black',
    design: '3 Crossfire designs, 2 shirts per design; logo requested on back' },

  { order: 'ORD-2026-0135', customer: 'Mark Taylor', qty: 4, shipping: 0, payment: 105,
    platform: 'Venmo', method: 'other',
    item: 'Custom T-Shirts', sizes: 'Orange: 1 XL, 1 2XL; Blue: 1 XL, 1 2XL', colour: 'Orange and Blue',
    design: 'Custom printed shirts; artwork/design details discussed extensively',
    note: 'The sheet records shipping as paid separately and not confirmed, so none is charged on the order.' },
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
        SELECT o.id, o.order_number, o.total, o.shipping_charges, o.amount_paid,
               o.payment_status::text AS payment_status, c.name AS customer,
               (SELECT COALESCE(SUM(qty),0) FROM order_items_apparel x WHERE x.order_id=o.id)::int AS qty,
               (SELECT count(*) FROM order_items_apparel x WHERE x.order_id=o.id)::int AS lines,
               o.notes
          FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.order_number = $1 AND o.deleted_at IS NULL`, [row.order])
      const found = rows[0]

      if (!found) { skipped.push({ row, why: 'no such order' }); continue }
      if (!(found.customer || '').toLowerCase().includes(row.customer.split(' ')[0].toLowerCase())) {
        skipped.push({ row, why: `the order belongs to ${found.customer}, not ${row.customer}` }); continue
      }
      if (found.qty !== row.qty) {
        skipped.push({ row, why: `the order has ${found.qty} pieces, the sheet says ${row.qty}` }); continue
      }
      if (cents(found.total) !== 0) {
        skipped.push({ row, why: `the order already totals ${money(found.total)} — not touching it` }); continue
      }
      if (found.lines !== 1) {
        skipped.push({ row, why: `the order has ${found.lines} lines; this only fills a single aggregate line` }); continue
      }
      ready.push({ ...row, id: found.id, existingNotes: found.notes })
    }

    console.log(`Ready to fill: ${ready.length} of ${SHEET.length}\n`)
    for (const r of ready) {
      const items = +(r.payment - r.shipping).toFixed(2)
      console.log(`  ${r.order}  ${r.customer}`)
      console.log(`      items ${money(items)} + shipping ${money(r.shipping)} = ${money(r.payment)} paid by ${r.platform}`)
      console.log(`      ${r.qty} pcs → ${money(items / r.qty)} each   ·   ${r.sizes}   ·   ${r.colour}`)
      if (r.sheetQty && r.sheetQty !== r.qty) console.log(`      note: ${r.note}`)
    }
    if (skipped.length) {
      console.log(`\nSkipped: ${skipped.length}`)
      for (const s of skipped) console.log(`  ${s.row.order}  ${s.row.customer} — ${s.why}`)
    }

    const totalMoney = ready.reduce((s, r) => s + r.payment, 0)
    console.log(`\n  ${money(totalMoney)} of confirmed payment across ${ready.length} order(s).`)

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!ready.length) { console.log('\nNothing to fill.'); return }

    await client.query('BEGIN')
    for (const r of ready) {
      const items = +(r.payment - r.shipping).toFixed(2)
      const unit = +(items / r.qty).toFixed(4)
      // The sizes and the colour go in the notes, not on the line. The line is
      // one aggregate row for the whole job, so a single size or colour on it
      // would be wrong anyway — and size is varchar(20), too short to hold
      // "2 Large; 2 2XL; 4 3XL; 4 4XL" without cutting it into a fragment that
      // reads like a different order.
      const note = [r.existingNotes,
        `Confirmed order sheet — ${r.item}`,
        `Sizes: ${r.sizes}`,
        `Colour: ${r.colour}`,
        `Design: ${r.design}`,
        `Paid ${money(r.payment)} via ${r.platform}${r.shipping ? ` (includes ${money(r.shipping)} shipping)` : ''}.`,
        r.note].filter(Boolean).join('\n')

      await client.query(`
        UPDATE orders
           SET subtotal = $2, shipping_charges = $3, total = $4,
               amount_paid = $4, payment_status = 'Paid', payment_terms = 'Paid',
               payment_method = $5, notes = $6, updated_at = NOW()
         WHERE id = $1`, [r.id, items, r.shipping, r.payment, r.method, note])

      // The aggregate line carries the money and what the sheet calls the job.
      await client.query(`
        UPDATE order_items_apparel
           SET item = $2, unit_price = $3, amount = $4
         WHERE order_id = $1`, [r.id, r.item.slice(0, 100), unit, items])
    }

    // Prove it: every order filled, every one adding up, and nothing else moved.
    const numbers = ready.map(r => r.order)
    const { rows: after } = await client.query(`
      SELECT order_number, subtotal, shipping_charges, total, amount_paid, payment_status::text AS payment_status,
             (SELECT SUM(amount) FROM order_items_apparel x WHERE x.order_id = o.id) AS line_amount
        FROM orders o WHERE order_number = ANY($1) ORDER BY order_number`, [numbers])
    const bad = after.filter(a =>
      cents(a.subtotal) + cents(a.shipping_charges) !== cents(a.total) ||
      cents(a.amount_paid) !== cents(a.total) ||
      a.payment_status !== 'Paid' ||
      cents(a.line_amount) !== cents(a.subtotal))
    if (bad.length) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — ${bad.length} order(s) did not come out right:`)
      bad.forEach(b => console.log(`  ${b.order_number}: ${money(b.subtotal)} + ${money(b.shipping_charges)} vs ${money(b.total)}, line ${money(b.line_amount)}, ${b.payment_status}`))
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nFilled ${ready.length} order(s).`)
    for (const a of after) {
      console.log(`  ${a.order_number}  ${money(a.subtotal)} + ${money(a.shipping_charges)} = ${money(a.total)}  ${a.payment_status}  ✓`)
    }
    const { rows: [left] } = await client.query(`
      SELECT count(*)::int AS n FROM orders
       WHERE deleted_at IS NULL AND source_system = 'decoinks_digi_apparel_2026' AND total = 0`)
    console.log(`\nDIGI orders still at zero: ${left.n}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
