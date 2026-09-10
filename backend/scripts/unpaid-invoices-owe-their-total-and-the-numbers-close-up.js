#!/usr/bin/env node
'use strict'

/**
 * Two things the Invoices list got wrong, put right on the owner's word.
 *
 * 1. An unpaid invoice owes its total. Invoices were born with balance_due 0
 *    ("the shop is paid before the work starts"), so an unpaid one read
 *    "Balance $0.00" in the list and its preview showed nothing due. The code
 *    now raises them owing their total; this puts the ones already raised that
 *    way right. Paid and Void invoices are left alone — an invoice marked Paid
 *    owes nothing whatever its ledger says.
 *
 * 2. The numbers close up. Merges and deleted test invoices left holes in the
 *    one sequence the book uses (127, 128, 129, 131, 151). Every invoice keeps
 *    its place in the order it already reads and its customer's letters; only
 *    the number moves down to fill the gap. Retired invoices still holding a
 *    number in the book's pattern are moved out of it with an X- prefix, as
 *    invoice-numbers-follow-the-house-rule.js does, so they can never be handed
 *    out or counted again, and the INV counter is set to the new last number so
 *    the next invoice follows straight on.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const PATTERN = '^[A-Z]{3}-[0-9]+$'

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')

    // 1. Balances
    const { rows: owing } = await client.query(
      `UPDATE invoices
          SET balance_due = GREATEST(total - amount_paid, 0), updated_at = NOW()
        WHERE deleted_at IS NULL AND status NOT IN ('Paid', 'Void')
          AND abs(balance_due - GREATEST(total - amount_paid, 0)) > 0.001
        RETURNING invoice_number, status, total, amount_paid, balance_due`)
    console.log(`1. Unpaid invoices now owing their total: ${owing.length}`)
    for (const r of owing) {
      console.log(`   ${r.invoice_number.padEnd(9)} ${String(r.status).padEnd(8)} total $${r.total}  paid $${r.amount_paid}  due $${r.balance_due}`)
    }

    // 2. Numbers
    const { rowCount: retired } = await client.query(
      `UPDATE invoices SET invoice_number = 'X-' || invoice_number
        WHERE deleted_at IS NOT NULL AND invoice_number ~ $1`, [PATTERN])

    const { rows: live } = await client.query(
      `SELECT id, invoice_number FROM invoices
        WHERE deleted_at IS NULL AND invoice_number ~ $1
        ORDER BY split_part(invoice_number, '-', 2)::int, created_at, id`, [PATTERN])
    const { rows: [{ odd }] } = await client.query(
      `SELECT COUNT(*)::int AS odd FROM invoices WHERE deleted_at IS NULL AND invoice_number !~ $1`, [PATTERN])
    if (odd) throw new Error(`${odd} live invoice(s) outside the AAA-0000 pattern — look at them first`)

    const moves = live
      .map((inv, i) => ({ ...inv, to: `${inv.invoice_number.slice(0, 3)}-${String(i + 1).padStart(4, '0')}` }))
      .filter(m => m.to !== m.invoice_number)

    console.log(`\n2. ${live.length} invoices; ${retired} retired number(s) moved out of the way; ${moves.length} renumbered:`)
    for (const m of moves) console.log(`   ${m.invoice_number} -> ${m.to}`)

    for (const m of moves) {
      await client.query(
        `UPDATE invoices SET invoice_number = 'TMP-' || substr(replace(id::text, '-', ''), 1, 16) WHERE id = $1`, [m.id])
    }
    for (const m of moves) {
      await client.query(
        `UPDATE invoices
            SET invoice_number = $2::text,
                internal_no = CASE WHEN internal_no LIKE 'INV-INT-%' THEN 'INV-INT-' || $2::text ELSE internal_no END,
                updated_at = NOW()
          WHERE id = $1`, [m.id, m.to])
    }
    await client.query(
      `INSERT INTO counters (scope, last_value) VALUES ('INV', $1)
       ON CONFLICT (scope) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`, [live.length])

    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS docs, MIN(split_part(invoice_number,'-',2)::int) AS lo,
              MAX(split_part(invoice_number,'-',2)::int) AS hi,
              COUNT(DISTINCT split_part(invoice_number,'-',2)::int)::int AS nums
         FROM invoices WHERE deleted_at IS NULL`)
    const ok = c.lo === 1 && c.hi === c.docs && c.nums === c.docs
    console.log(`\n   ${c.docs} invoices, ${c.lo}–${c.hi}, unique ${c.nums === c.docs ? 'yes' : 'no'}   ${ok ? '✓' : '✗'}`)
    if (!ok) throw new Error('numbering is still not 1..N')

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
