#!/usr/bin/env node
/**
 * Put ten quotations onto the same convention as everything else.
 *
 * A quotation's subtotal is the item lines only; shipping and rush are added on
 * top of it to make the total, which is how the invoice, the sales order and
 * the purchase order all read. Ten quotations predate that: their subtotal has
 * the shipping folded into it and their total equals the subtotal. Internally
 * consistent under the old rule, and the preview printed them correctly by
 * subtracting shipping back out.
 *
 * That subtraction is wrong for every quotation written since, so the preview
 * now reads subtotal as the lines. These ten are the only rows that disagree,
 * and each one has an invoice made from it that already holds the correct
 * split — the invoice separated the lines from the shipping at conversion time.
 * The invoice is the evidence; nothing here is inferred.
 *
 *   Q-2026-0010   quote  subtotal 64.00, shipping 15.00, total 64.00
 *                 invoice  items 49.00 + shipping 15.00 = 64.00
 *                 → quote subtotal becomes 49.00. The total does not move.
 *
 * ONLY QUOTES WHOSE TOTAL DOES NOT CHANGE ARE REPAIRED. A quotation is what the
 * customer was told the job would cost; correcting how it is split internally
 * is bookkeeping, changing what it adds up to is not. Any quote whose total
 * would move is listed and left alone for the owner to settle.
 *
 * Usage:
 *   node backend/scripts/repair-quote-total-splits.js            (dry-run)
 *   node backend/scripts/repair-quote-total-splits.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const money = n => `$${Number(n || 0).toFixed(2)}`
const cents = n => Math.round(Number(n || 0) * 100)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows } = await client.query(`
      SELECT q.id, q.quote_number, q.subtotal, q.discount_amt,
             COALESCE(q.estimated_shipping,0) AS ship, COALESCE(q.rush_services,0) AS rush, q.total,
             i.invoice_number, i.subtotal AS inv_items, COALESCE(i.shipping_charges,0) AS inv_ship,
             COALESCE(i.rush_charges,0) AS inv_rush, i.total AS inv_total,
             COALESCE((SELECT SUM(amount) FROM quotation_items qi WHERE qi.quotation_id = q.id), 0) AS own_lines
        FROM quotations q
        LEFT JOIN invoices i ON i.quote_id = q.id AND i.deleted_at IS NULL
       WHERE q.deleted_at IS NULL
         AND ROUND(q.total,2) <> ROUND(q.subtotal - q.discount_amt
                                       + COALESCE(q.estimated_shipping,0)
                                       + COALESCE(q.rush_services,0), 2)
       ORDER BY q.quote_number`)

    console.log(`Quotations whose parts do not add up to their total: ${rows.length}\n`)

    const safe = []
    const needsOwner = []
    for (const r of rows) {
      if (!r.invoice_number) {
        needsOwner.push({ ...r, why: 'no invoice was ever made from it, so there is nothing to read the split from' })
        continue
      }
      // The invoice holds the split the shop actually billed.
      const items = Number(r.inv_items)
      const ship = Number(r.inv_ship)
      const rush = Number(r.inv_rush)
      const newTotal = +(items - Number(r.discount_amt) + ship + rush).toFixed(2)

      // Two independent sources must agree before anything is written: the
      // invoice's split, and the quotation's own line items. They are recorded
      // separately, so agreement is not a coincidence.
      if (cents(r.own_lines) !== cents(items)) {
        needsOwner.push({ ...r, items, ship, rush,
          why: `the invoice says the lines come to ${money(items)} but the quotation's own lines come to ${money(r.own_lines)}` })
        continue
      }
      if (cents(newTotal) !== cents(r.total)) {
        needsOwner.push({ ...r, items, ship, rush, newTotal,
          why: `the invoice adds up to ${money(newTotal)} but the quotation says ${money(r.total)}` })
        continue
      }
      safe.push({ ...r, items, ship, rush, newTotal })
    }

    if (safe.length) {
      console.log(`Repairable — the invoice gives the split and the total does not move: ${safe.length}`)
      for (const s of safe) {
        console.log(`  ${s.quote_number}  subtotal ${money(s.subtotal)} → ${money(s.items)}` +
          `   shipping ${money(s.ship)}   total stays ${money(s.total)}`)
        console.log(`      its own lines come to ${money(s.own_lines)}, and ${s.invoice_number} bills the same`)
      }
    }

    if (needsOwner.length) {
      console.log(`\nLeft alone — these need the owner to say which figure is right: ${needsOwner.length}`)
      for (const n of needsOwner) {
        console.log(`  ${n.quote_number}  quotation ${money(n.total)}` +
          `${n.invoice_number ? `, invoice ${n.invoice_number} ${money(n.inv_total)}` : ''}`)
        console.log(`      ${n.why}`)
      }
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }
    if (!safe.length) { console.log('\nNothing to repair.'); return }

    await client.query('BEGIN')
    for (const s of safe) {
      await client.query(
        `UPDATE quotations
            SET subtotal = $2, estimated_shipping = $3, rush_services = $4, total = $5, updated_at = NOW()
          WHERE id = $1`,
        [s.id, s.items, s.ship, s.rush, s.newTotal])
    }

    // Prove it: every repaired quote now adds up, and not one total moved.
    const { rows: [after] } = await client.query(`
      SELECT count(*) FILTER (WHERE ROUND(total,2) <> ROUND(subtotal - discount_amt
              + COALESCE(estimated_shipping,0) + COALESCE(rush_services,0), 2))::int AS still_off,
             SUM(total) AS total_of_all
        FROM quotations WHERE deleted_at IS NULL`)
    const { rows: [before] } = await client.query(
      `SELECT $1::numeric AS expected`, [rows.reduce((s, r) => s + Number(r.total), 0).toFixed(2)])

    const movedTotal = safe.reduce((s, r) => s + (cents(r.newTotal) - cents(r.total)), 0)
    if (movedTotal !== 0) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — ${movedTotal} cent(s) of quoted value would have moved.`)
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    console.log(`\nRepaired ${safe.length} quotation(s). Not one total changed.`)
    console.log(`Quotations that still do not add up: ${after.still_off}` +
      (after.still_off === needsOwner.length ? `  — the ${needsOwner.length} above, awaiting the owner` : '  ✗ unexpected'))
    void before
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
