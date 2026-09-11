#!/usr/bin/env node
'use strict'

/**
 * The payments table is money that arrived. Nothing else belongs in it.
 *
 * Two writers used to invent rows: creating an invoice with "Paid" ticked, and
 * raising a sales order for an invoice that said it was paid. Both have been
 * removed from the code. This clears up what they already wrote, and repairs a
 * second fault found alongside it — customers.company and customers.company_name
 * drifting apart, which made the Edit Customer form look like it saved nothing.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/only-real-money-is-in-the-ledger.js
 *   node scripts/only-real-money-is-in-the-ledger.js --apply
 */

require('dotenv').config()
const { pool } = require('../src/config/db')

const APPLY = process.argv.includes('--apply')
const say = (...a) => console.log(...a)

async function main() {
  say(APPLY ? '── APPLYING ──' : '── DRY RUN (add --apply to write) ──', '\n')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── 1. Invented payments that duplicate a real one ──────────────────────
    //
    // Only where the same customer already has a payment for the same amount
    // that carries a processor transaction id. That id is proof the money was
    // actually taken, and it is the row the shop should keep. An invented row
    // with no such twin is the only record of its money and is left alone for
    // the owner to rule on — deleting it would erase the money, not a duplicate.
    const { rows: invented } = await client.query(`
      SELECT p.id, p.payment_number, p.amount, i.invoice_number, i.customer_name,
             real.payment_number AS keeps, real.transaction_id
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        JOIN LATERAL (
          SELECT r.payment_number, r.transaction_id
            FROM payments r
           WHERE r.id <> p.id
             AND r.customer_id = i.customer_id
             AND r.amount = p.amount
             AND NULLIF(BTRIM(r.transaction_id), '') IS NOT NULL
           ORDER BY r.created_at
           LIMIT 1
        ) real ON TRUE
       WHERE p.notes = 'Full payment recorded when invoice was created'
       ORDER BY p.payment_number`)

    say(`1. Invented payments that duplicate a real one: ${invented.length}`)
    for (const r of invented) {
      say(`   DELETE ${r.payment_number} $${r.amount} (${r.customer_name}, ${r.invoice_number})`)
      say(`          keeping ${r.keeps} — txn ${r.transaction_id}`)
    }

    // ── 2. The real payment, joined to the job it paid for ──────────────────
    //
    // The kept payment arrived through the link before any document existed, so
    // it points at no invoice. Attaching it puts the money and the paperwork on
    // the same job, which is what the deleted row was pretending to do.
    const { rows: toAttach } = await client.query(`
      SELECT r.id, r.payment_number, r.amount, i.id AS invoice_id, i.invoice_number,
             o.id AS order_id, o.order_number
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN orders o ON o.invoice_id = i.id AND o.deleted_at IS NULL
        JOIN LATERAL (
          SELECT r.id, r.payment_number, r.amount
            FROM payments r
           WHERE r.id <> p.id
             AND r.customer_id = i.customer_id
             AND r.amount = p.amount
             AND NULLIF(BTRIM(r.transaction_id), '') IS NOT NULL
             AND r.invoice_id IS NULL
           ORDER BY r.created_at
           LIMIT 1
        ) r ON TRUE
       WHERE p.notes = 'Full payment recorded when invoice was created'`)

    say(`\n2. Real payments to attach to their invoice: ${toAttach.length}`)
    for (const r of toAttach) {
      say(`   ${r.payment_number} $${r.amount} → ${r.invoice_number}${r.order_number ? ` / ${r.order_number}` : ''}`)
    }

    // ── 3. One company, one value ───────────────────────────────────────────
    //
    // create() wrote the same company into both columns; update() wrote only
    // one, so an edit made them disagree and each screen showed whichever it
    // read. The filled one is the truth — where both are filled and differ, the
    // one the edit form writes (company_name) is the later word.
    const { rows: companies } = await client.query(`
      SELECT id, customer_number, name,
             NULLIF(BTRIM(company), '')      AS company,
             NULLIF(BTRIM(company_name), '') AS company_name
        FROM customers
       WHERE deleted_at IS NULL
         AND COALESCE(NULLIF(BTRIM(company), ''), '') <> COALESCE(NULLIF(BTRIM(company_name), ''), '')
       ORDER BY customer_number`)

    say(`\n3. Customers whose two company columns disagree: ${companies.length}`)
    for (const c of companies) {
      const settled = c.company_name || c.company
      say(`   ${c.customer_number} ${c.name}`)
      say(`      company="${c.company ?? ''}" company_name="${c.company_name ?? ''}" → "${settled}"`)
    }

    if (!APPLY) {
      await client.query('ROLLBACK')
      say('\nNothing written. Re-run with --apply.')
      return
    }

    for (const r of toAttach) {
      await client.query(
        `UPDATE payments SET invoice_id = $2, order_id = COALESCE(order_id, $3), updated_at = NOW()
          WHERE id = $1`, [r.id, r.invoice_id, r.order_id])
    }
    for (const r of invented) {
      await client.query(`DELETE FROM payments WHERE id = $1`, [r.id])
    }
    for (const c of companies) {
      const settled = c.company_name || c.company
      await client.query(
        `UPDATE customers SET company = $2, company_name = $2, updated_at = NOW() WHERE id = $1`,
        [c.id, settled])
    }

    await client.query('COMMIT')
    say(`\nWritten: ${invented.length} payment(s) deleted, ${toAttach.length} attached, ${companies.length} customer(s) settled.`)

    // ── Numbering must still read 1..N with no hole ──────────────────────────
    const { rows: gap } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             MAX(split_part(payment_number, '-', 3)::int) AS highest
        FROM payments WHERE payment_number IS NOT NULL`)
    say(`Payments: ${gap[0].total} rows, highest number ${gap[0].highest}` +
        (gap[0].total === gap[0].highest ? ' — contiguous.' : ' — NOT contiguous, renumber needed.'))
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
