#!/usr/bin/env node
'use strict'

/**
 * Valeria Battle's job has one invoice, not two.
 *
 * Quote Q-2026-0156 carries two $308 invoices with the same lines: the paid one
 * that her order and payment sit on, and a draft raised earlier that day which
 * nobody paid against. The draft is the only reason the Invoices list shows
 * $308 of her job as still owed. On the owner's word — the balance due is
 * only the invoice that went out unpaid — the draft is soft-deleted and its
 * number parked, so the invoice numbering can close up after it.
 *
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')

async function main() {
  const client = await pool.connect()
  console.log(APPLY ? '-- APPLYING --\n' : '-- DRY RUN (add --apply to write) --\n')
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT i.id, i.invoice_number, i.status, i.total, i.amount_paid, i.balance_due,
              (SELECT string_agg(description || qty || unit_price, '|' ORDER BY sort_order)
                 FROM invoice_items WHERE invoice_id = i.id) AS lines,
              (SELECT COUNT(*) FROM payments WHERE invoice_id = i.id)::int
            + (SELECT COUNT(*) FROM orders WHERE invoice_id = i.id AND deleted_at IS NULL)::int
            + (SELECT COUNT(*) FROM payment_links WHERE invoice_id = i.id)::int AS refs
         FROM invoices i JOIN quotations q ON q.id = i.quote_id
        WHERE q.quote_number = 'Q-2026-0156' AND i.deleted_at IS NULL
        ORDER BY i.status = 'Paid' DESC`)
    const [paid, draft] = rows
    if (rows.length !== 2 || paid.status !== 'Paid' || draft.status !== 'Draft') {
      throw new Error(`expected one Paid and one Draft invoice on Q-2026-0156, found ${rows.map(r => r.invoice_number + ' ' + r.status)}`)
    }
    if (paid.lines !== draft.lines || Number(paid.total) !== Number(draft.total) || draft.refs || Number(draft.amount_paid)) {
      throw new Error(`${draft.invoice_number} is not an untouched copy of ${paid.invoice_number} — refusing`)
    }
    console.log(`   keep ${paid.invoice_number}  $${paid.total}  Paid (her order and payment)`)
    console.log(`   drop ${draft.invoice_number}  $${draft.total}  Draft, owing $${draft.balance_due} — same lines, nothing attached`)

    await client.query(
      `UPDATE invoices
          SET deleted_at = NOW(),
              invoice_number = 'D-' || invoice_number || '-' || left(replace(id::text, '-', ''), 4),
              notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW()
        WHERE id = $1`, [draft.id, `Duplicate of ${paid.invoice_number}, which carries the order and payment.`])

    const { rows: [due] } = await client.query(
      `SELECT string_agg(invoice_number || ' $' || balance_due, ', ') AS owing
         FROM invoices WHERE deleted_at IS NULL AND balance_due > 0`)
    console.log(`\n   still owing: ${due.owing}`)

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
