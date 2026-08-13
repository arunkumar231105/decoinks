#!/usr/bin/env node
/**
 * Close the holes in the sales-order numbering without reshuffling anything.
 *
 * Deleting orders left ORD-2026-0072, 0073, 0075 and 0080 unused, so the list
 * counts 0071, 0074, 0076… The owner asked for the gaps closed and nothing
 * else moved, so the existing sequence is preserved exactly: orders are sorted
 * by the number they already carry and renumbered 1..N. Only the twelve orders
 * after the first hole shift down; every order before it keeps its number.
 *
 * Nothing else has to be rewritten to follow: order_number is stored in exactly
 * one place in the schema, and invoices, quotations, POs, payments and shipments
 * all link by the row's UUID — so they show the new number automatically.
 *
 * Two things do need handling, and this script does both:
 *   - counters. Numbers are issued from a high-water mark, so after the top
 *     order becomes 0083 the counter must come down to 83 as well, otherwise
 *     the next order is 0088 and four fresh holes appear.
 *   - shipment notes. One imported shipment quotes an order number in its note;
 *     the text is rewritten through the same mapping. activity_logs also quotes
 *     order numbers, but that is an audit trail of what was said at the time and
 *     is deliberately left untouched.
 *
 * Renaming is done in two passes (park at T-n first) so a target number can
 * never collide with a row that still holds it. Soft-deleted rows are parked
 * under a D- prefix, matching fix-dates-and-renumber.js.
 *
 * Usage:
 *   node backend/scripts/close-order-number-gaps.js            (dry-run)
 *   node backend/scripts/close-order-number-gaps.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: unparked } = await client.query(
      `SELECT count(*)::int AS n FROM orders WHERE deleted_at IS NOT NULL AND order_number NOT LIKE 'D-%'`)
    if (unparked[0].n) console.log(`Soft-deleted orders still holding a number: ${unparked[0].n} (will be parked as D-…)`)

    // Sorted by the number they already have — this is what preserves the order.
    const { rows } = await client.query(
      `SELECT id, order_number, order_date,
              substring(order_number from '-([0-9]{4})-') AS yr
         FROM orders
        WHERE deleted_at IS NULL AND order_number ~ '^ORD-[0-9]{4}-[0-9]+$'
        ORDER BY order_number`)

    const counter = {}
    const moves = []
    for (const r of rows) {
      counter[r.yr] = (counter[r.yr] || 0) + 1
      const next = `ORD-${r.yr}-${String(counter[r.yr]).padStart(4, '0')}`
      if (next !== r.order_number) moves.push({ ...r, next })
    }

    console.log(`Live orders: ${rows.length} — renumbering: ${moves.length}`)
    for (const m of moves) console.log(`  ${m.order_number} → ${m.next}`)
    for (const [yr, n] of Object.entries(counter)) {
      const { rows: [c] } = await client.query(`SELECT last_value FROM counters WHERE scope = $1`, [`ORD-${yr}`])
      console.log(`\nCounter ORD-${yr}: ${c ? c.last_value : '(none)'} → ${n}   (next new order becomes ORD-${yr}-${String(n + 1).padStart(4, '0')})`)
    }

    const { rows: notes } = await client.query(
      `SELECT shipment_number, notes FROM shipments
        WHERE deleted_at IS NULL AND notes LIKE '%ORD-%'`)
    const noteHits = notes.filter(n => moves.some(m => n.notes.includes(m.order_number)))
    if (noteHits.length) {
      console.log(`\nShipment notes quoting a renumbered order: ${noteHits.length}`)
      noteHits.forEach(n => console.log(`  ${n.shipment_number}: ${n.notes}`))
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    await client.query(
      `UPDATE orders SET order_number = 'D-' || RIGHT(id::text, 12)
        WHERE deleted_at IS NOT NULL AND order_number NOT LIKE 'D-%'`)

    // Pass 1 — park every mover out of the way.
    for (let i = 0; i < moves.length; i++) {
      await client.query(`UPDATE orders SET order_number = $2 WHERE id = $1`, [moves[i].id, `T-${i}`])
    }
    // Pass 2 — settle on the final numbers.
    for (const m of moves) {
      await client.query(`UPDATE orders SET order_number = $2, updated_at = NOW() WHERE id = $1`, [m.id, m.next])
    }

    for (const n of noteHits) {
      let text = n.notes
      for (const m of moves) text = text.split(m.order_number).join(m.next)
      await client.query(`UPDATE shipments SET notes = $2, updated_at = NOW() WHERE shipment_number = $1`,
        [n.shipment_number, text])
    }

    for (const [yr, n] of Object.entries(counter)) {
      await client.query(
        `UPDATE counters SET last_value = $2, updated_at = NOW() WHERE scope = $1`, [`ORD-${yr}`, n])
    }
    await client.query('COMMIT')

    const { rows: [check] } = await client.query(
      `SELECT count(*)::int AS live,
              max(CAST(SPLIT_PART(order_number, '-', 3) AS int)) AS highest
         FROM orders WHERE deleted_at IS NULL AND order_number ~ '^ORD-[0-9]{4}-[0-9]+$'`)
    console.log(`\nRenumbered ${moves.length} order(s). Live orders: ${check.live}, highest number: ${check.highest}` +
      `${check.live === check.highest ? ' — no gaps left.' : ' — GAPS REMAIN, check this.'}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
