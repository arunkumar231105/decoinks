#!/usr/bin/env node
/**
 * Bring stored subtotals back in line with the lines they are made of.
 *
 * A document's subtotal is the quoted figure: the exact rate x qty summed and
 * rounded once. Each printed line is rounded on its own, so with a rate finer
 * than a cent the lines can add to a few cents less — that is expected, and the
 * quoted figure is what the document carries. This repairs rows whose stored
 * subtotal drifted away from that figure.
 *
 * A document is only touched when its stored subtotal differs from the the quoted figure by a few cents, and the total moves by exactly the same
 * difference, so shipping, rush, discount and tax are left untouched. A larger
 * gap is a different fault — usually a subtotal with the shipping folded into it,
 * whose total is already correct — and is reported instead of adjusted.
 *
 * Paid invoices and their orders are reported rather than moved — shifting a
 * settled total would leave a customer owing cents nobody asked for.
 *
 * Usage:
 *   node backend/scripts/resync-document-subtotals.js                       (survey)
 *   node backend/scripts/resync-document-subtotals.js --only=Q-2026-0110 --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
// Restrict to named documents. Without this the rule sweeps up ~111 imported
// rows whose header total was authoritative and whose single aggregate line
// carries a derived rate that does not multiply back to the cent. Those are not
// drift and must not be rewritten, so a repair always names its targets.
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
  .split(',').map(x => x.trim()).filter(Boolean)
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

const SOURCES = [
  { label: 'quotations', table: 'quotations', number: 'quote_number',
    lines: `SELECT ROUND(COALESCE(SUM(qty * unit_price),0), 2) FROM quotation_items WHERE quotation_id = d.id` },
  { label: 'invoices', table: 'invoices', number: 'invoice_number',
    lines: `SELECT ROUND(COALESCE(SUM(qty * unit_price),0), 2) FROM invoice_items WHERE invoice_id = d.id`,
    skipIf: `COALESCE(d.amount_paid,0) > 0` },
  { label: 'orders', table: 'orders', number: 'order_number',
    lines: `SELECT ROUND(COALESCE(SUM(v),0), 2) FROM (
              SELECT qty * unit_price      AS v FROM order_items_dtf       WHERE order_id = d.id
              UNION ALL SELECT qty * unit_price      FROM order_items_apparel   WHERE order_id = d.id
              UNION ALL SELECT qty * price_per_sheet FROM order_items_gangsheet WHERE order_id = d.id) x`,
    skipIf: `COALESCE(d.amount_paid,0) > 0` },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const plan = []
    for (const s of SOURCES) {
      const { rows } = await client.query(
        `SELECT d.id, d.${s.number} AS number, d.subtotal, d.total,
                (${s.lines})::numeric(12,2) AS quoted_sum,
                ((${s.lines}) - d.subtotal)::numeric(12,2) AS delta
                ${s.skipIf ? `, (${s.skipIf}) AS settled` : ', FALSE AS settled'}
           FROM ${s.table} d
          WHERE d.deleted_at IS NULL
            AND (${s.lines}) > 0
            AND abs((${s.lines}) - d.subtotal) >= 0.01
          ORDER BY d.${s.number}`)
      rows.forEach(r => plan.push({ ...s, ...r }))   // row values win over the source config
    }

    // Only the few-cent drift this change caused is repaired here. A larger gap
    // means something else — most of these are older rows whose subtotal was
    // stored with the shipping already folded in, so their total is already
    // right and shifting it by the difference would knock the shipping back off.
    const DRIFT_LIMIT = 0.10
    const named = (r) => ONLY.length === 0 || ONLY.includes(String(r.number))
    const fixable = plan.filter(r => named(r) && !r.settled && Math.abs(Number(r.delta)) <= DRIFT_LIMIT)
    const settled = plan.filter(r => named(r) && r.settled)
    const bigger  = plan.filter(r => named(r) && !r.settled && Math.abs(Number(r.delta)) > DRIFT_LIMIT)

    console.log(`Documents off the quoted figure: ${plan.length}` +
      `${ONLY.length ? ` — repairing only the ${ONLY.length} named` : ' — name targets with --only= to repair'}\n`)
    for (const r of fixable) {
      console.log(`  ${r.label.padEnd(11)} ${String(r.number).padEnd(20)} ` +
        `subtotal $${r.subtotal} → $${r.quoted_sum}   total $${r.total} → $${(Number(r.total) + Number(r.delta)).toFixed(2)}`)
    }
    if (bigger.length) {
      console.log(`\nNot rounding drift — reported only, these need a human (${bigger.length}):`)
      bigger.forEach(r => console.log(`  ${r.label} ${r.number}: subtotal $${r.subtotal} vs lines $${r.quoted_sum} ` +
        `(off by $${Math.abs(Number(r.delta)).toFixed(2)} — likely shipping folded into the subtotal)`))
    }
    if (settled.length) {
      console.log(`\nLeft alone — money already received, so the total is not moved silently (${settled.length}):`)
      settled.forEach(r => console.log(`  ${r.label} ${r.number}: stored $${r.subtotal}, lines $${r.quoted_sum}`))
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    for (const r of fixable) {
      await client.query(
        `UPDATE ${r.table} SET subtotal = $2, total = (total + $3)::numeric(12,2), updated_at = NOW()
          WHERE id = $1`, [r.id, r.quoted_sum, r.delta])
      if (r.table === 'invoices') {
        await client.query(
          `UPDATE invoices SET balance_due = (total - COALESCE(amount_paid,0))::numeric(12,2) WHERE id = $1`, [r.id])
      }
    }
    await client.query('COMMIT')
    console.log(`\nRe-synced ${fixable.length} document(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
