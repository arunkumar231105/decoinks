#!/usr/bin/env node
/**
 * Move payments that were booked against the wrong sales order.
 *
 * The money arrived from the right customer, but the ledger row was attached to
 * a different order of theirs — so one order reads as massively overpaid while
 * the order that was actually settled shows no payment at all. The clearest
 * case: a $1,913 Zelle payment sits on ORD-2026-0047 (a $10 order that did not
 * exist yet on the payment date) while ORD-2026-0029 — $1,913 of goods, dated
 * the day before — has no ledger row.
 *
 * Only moves where the evidence is unambiguous are listed here. Each one is
 * re-verified against the database before anything is written; if any check
 * fails the whole run aborts rather than guessing:
 *   - the payment is currently on the order named in `from`,
 *   - both orders belong to the same customer,
 *   - the destination order has no payment rows of its own,
 *   - the payment amount equals the destination's total or its subtotal
 *     (an amount that excludes shipping), within a cent.
 *
 * A payment moving off an order leaves that order's amount_paid overstated, so
 * it is reset to the order's own total — every source order here is marked Paid
 * and its invoice says Paid, so the total is the correct figure. Nothing else is
 * touched: no payment status, no invoice, no amount is created or deleted.
 *
 * Deliberately NOT moved (reported at the end instead — the owner has to say):
 *   - Vianelly Chichipa's $245 on ORD-2026-0070 ($15). She has only one order,
 *     so there is nowhere within her account for it to go.
 *   - Kyle Morris's $40 (PAY-2026-0025) on ORD-2026-0052. No order of his
 *     matches that amount.
 *   - Kyle Morris's $115 (PAY-2026-0036) on ORD-2026-0034 ($100) — same date as
 *     the order, so it is on the right one; the extra $15 is unexplained.
 *
 * Usage:
 *   node backend/scripts/reallocate-misattributed-payments.js            (dry-run)
 *   node backend/scripts/reallocate-misattributed-payments.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const MOVES = [
  { payment: 'PAY-2026-0038', from: 'ORD-2026-0047', to: 'ORD-2026-0029',
    why: '$1,913 on 6 Jun = the goods value of ORD-2026-0029 (5 Jun); ORD-2026-0047 was not raised until 7 Jul' },
  { payment: 'PAY-2026-0058', from: 'ORD-2026-0022', to: 'ORD-2026-0003',
    why: '$46.85 on 22 Apr = ORD-2026-0003 exactly (24 Apr); ORD-2026-0022 is a $10 order from 26 May' },
  { payment: 'PAY-2026-0063', from: 'ORD-2026-0026', to: 'ORD-2026-0002',
    why: '$39 on 20 Apr, with the $1 test transfer below, makes ORD-2026-0002 exactly ($40, 21 Apr)' },
  { payment: 'PAY-2026-0064', from: 'ORD-2026-0026', to: 'ORD-2026-0002',
    why: '$1 "test transfer" on 20 Apr, same customer and day as PAY-2026-0063' },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const checked = []
    for (const m of MOVES) {
      const { rows: [row] } = await client.query(
        `SELECT y.id AS payment_id, y.amount, y.payment_date, y.customer_id,
                src.id AS src_id, src.order_number AS src_no, src.total AS src_total,
                dst.id AS dst_id, dst.order_number AS dst_no, dst.total AS dst_total,
                dst.subtotal AS dst_subtotal, dst.customer_id AS dst_customer,
                src.customer_id AS src_customer,
                (SELECT count(*) FROM payments p2 WHERE p2.order_id = dst.id)::int AS dst_payments
           FROM payments y
           JOIN orders src ON src.id = y.order_id
           JOIN orders dst ON dst.order_number = $3 AND dst.deleted_at IS NULL
          WHERE y.payment_number = $1 AND src.order_number = $2`,
        [m.payment, m.from, m.to])

      if (!row) throw new Error(`${m.payment}: not found on ${m.from} — the data has changed, aborting`)
      const amt = Number(row.amount)
      const fitsTotal    = Math.abs(amt - Number(row.dst_total)) < 0.01
      const fitsSubtotal = Math.abs(amt - Number(row.dst_subtotal)) < 0.01
      // PAY-2026-0063/0064 are two halves of one settlement, so they are checked
      // as a pair against the destination rather than individually.
      const pairTotal = MOVES.filter(x => x.to === m.to)
        .reduce((s, x) => s + (x.payment === m.payment ? amt : 0), 0)
      const fitsPair = MOVES.filter(x => x.to === m.to).length > 1

      if (row.src_customer !== row.dst_customer) throw new Error(`${m.payment}: ${m.from} and ${m.to} are different customers — aborting`)
      if (row.dst_payments > 0) throw new Error(`${m.payment}: ${m.to} already has a payment row — aborting`)
      if (!fitsTotal && !fitsSubtotal && !fitsPair) throw new Error(`${m.payment}: $${amt} matches neither ${m.to}'s total nor its subtotal — aborting`)

      checked.push({ ...m, ...row, amt, pairTotal })
    }

    // The paired payments must add up to the destination total exactly.
    for (const to of new Set(checked.filter(c => MOVES.filter(x => x.to === c.to).length > 1).map(c => c.to))) {
      const group = checked.filter(c => c.to === to)
      const sum = group.reduce((s, c) => s + c.amt, 0)
      if (Math.abs(sum - Number(group[0].dst_total)) >= 0.01) {
        throw new Error(`${to}: the payments being moved total $${sum.toFixed(2)} but the order is $${group[0].dst_total} — aborting`)
      }
    }

    console.log(`Payments to move: ${checked.length}\n`)
    for (const c of checked) {
      console.log(`  ${c.payment}  $${c.amt.toFixed(2).padStart(9)}  ${String(c.payment_date).slice(0, 15)}`)
      console.log(`      ${c.src_no} ($${c.src_total}) → ${c.dst_no} ($${c.dst_total})`)
      console.log(`      ${c.why}`)
    }

    const srcOrders = [...new Set(checked.map(c => c.src_no))]
    console.log(`\nAfter the move, amount_paid is reset to the order's own total on: ${srcOrders.join(', ')}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    for (const c of checked) {
      await client.query(`UPDATE payments SET order_id = $1, updated_at = NOW() WHERE id = $2`,
        [c.dst_id, c.payment_id])
    }
    const { rowCount } = await client.query(
      `UPDATE orders SET amount_paid = total, updated_at = NOW()
        WHERE order_number = ANY($1) AND deleted_at IS NULL AND amount_paid <> total`,
      [srcOrders])
    await client.query('COMMIT')
    console.log(`\nMoved ${checked.length} payment(s); corrected amount_paid on ${rowCount} order(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
