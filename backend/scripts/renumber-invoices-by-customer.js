#!/usr/bin/env node
/**
 * Put every invoice on the same numbering: three letters of the customer's
 * name, then that customer's own count.
 *
 * Two schemes are in the book at once. Ninety-seven invoices read
 * INV-2026-0001 upward, from before the naming changed; two read BMO-0002 and
 * HGA-0004, from after. A list showing both looks like a mistake, and the
 * customer's own sequence is broken by every invoice still on the old scheme.
 *
 * THE RULE IS NOT REDEFINED HERE. buildInvoicePrefix in src/utils/counter.js is
 * what the application uses when it numbers a new invoice — first letter of the
 * given name, first two of the family name; a single-word name gives its own
 * first three. This imports that function rather than copying it, so a number
 * written today and a number written by the next invoice cannot drift apart.
 *
 * THE LETTERS SAY WHO, THE NUMBER SAYS WHEN. The three letters name the
 * customer; the number is the invoice's place in the whole book, oldest 1 to
 * newest N. Counting per customer instead was tried and read wrong on the
 * screen: sorted by date the list jumped VCA-0001, ATA-0003, JJU-0006, which
 * is a sequence of nothing. Ordered by issue date, then created_at, then the
 * row's id, so the result is the same every run.
 *
 * TWO CODES ARE SHARED. ROBERT FARRAR and Robert Farrar differ only in case and
 * are the same person. Abdiel Castro and Alex M. Cabrera are not, and both give
 * ACA — they share the sequence, which is what a three-letter scheme does. The
 * numbers stay unique either way; the dry run names them so it is a choice.
 *
 * Usage:
 *   node backend/scripts/renumber-invoices-by-customer.js            (dry-run)
 *   node backend/scripts/renumber-invoices-by-customer.js --apply
 */
const fs = require('fs')
const { Pool } = require('pg')
const { buildInvoicePrefix } = require('../src/utils/counter')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

const pad = n => String(n).padStart(4, '0')

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const { rows } = await client.query(`
      SELECT i.id, i.invoice_number, i.issue_date, i.created_at,
             COALESCE(NULLIF(TRIM(i.customer_name), ''), NULLIF(TRIM(c.name), '')) AS customer
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.deleted_at IS NULL
       ORDER BY i.issue_date, i.created_at, i.id`)

    const noName = rows.filter(r => !r.customer)
    const byCode = new Map()
    for (const r of rows) {
      const code = buildInvoicePrefix(r.customer || 'Customer')
      if (!byCode.has(code)) byCode.set(code, [])
      byCode.get(code).push(r)
    }

    // rows already arrive oldest first, so the index is the place in the book.
    const moves = []
    rows.forEach((r, i) => {
      const code = buildInvoicePrefix(r.customer || 'Customer')
      const to = `${code}-${pad(i + 1)}`
      if (to !== r.invoice_number) moves.push({ ...r, code, to })
    })

    console.log(`${rows.length} invoices across ${byCode.size} customer codes` +
      `   ${moves.length} change number`)
    if (noName.length) {
      console.log(`  ${noName.length} invoice(s) have no customer name and fall back to a generic code:`)
      noName.forEach(r => console.log(`      ${r.invoice_number}`))
    }

    // Codes covering more than one person, so the choice is visible.
    const shared = [...byCode.entries()]
      .map(([code, list]) => ({ code, list, people: [...new Set(list.map(r => (r.customer || '').toLowerCase()))] }))
      .filter(x => x.people.length > 1)
    if (shared.length) {
      console.log(`\n  ${shared.length} code(s) cover more than one spelling or person:`)
      for (const s of shared) {
        const names = [...new Set(s.list.map(r => r.customer))].join(' | ')
        console.log(`      ${s.code}  ${s.list.length} invoices  —  ${names}`)
      }
    }

    // The newest end, which is what the shop looks at first.
    console.log('\n  How the newest end of the list will read:')
    for (const r of rows.slice(-5).reverse()) {
      const code = buildInvoicePrefix(r.customer || 'Customer')
      console.log(`      ${String(r.issue_date).slice(0, 10)}   ${r.invoice_number.padEnd(14)} → ` +
        `${code}-${pad(rows.indexOf(r) + 1)}   ${r.customer}`)
    }

    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.'); return }
    if (!moves.length) { console.log('\nNothing to renumber.'); return }

    await client.query('BEGIN')

    // Deleted invoices still hold numbers and the unique index spans them.
    const { rowCount: parked } = await client.query(
      `UPDATE invoices SET invoice_number = 'D-' || RIGHT(id::text, 12)
        WHERE deleted_at IS NOT NULL AND invoice_number !~ '^D-'`)
    if (parked) console.log(`\nParked ${parked} deleted invoice(s) that were still holding a number.`)

    // Two passes: park, then place. Almost every invoice is moving onto a
    // number another one currently holds.
    for (let i = 0; i < moves.length; i++) {
      await client.query(`UPDATE invoices SET invoice_number = $2 WHERE id = $1`,
        [moves[i].id, `TMP-INV-${i}`])
    }
    for (const m of moves) {
      await client.query(`UPDATE invoices SET invoice_number = $2, updated_at = NOW() WHERE id = $1`,
        [m.id, m.to])
    }

    // One counter for the whole book: the number is the invoice's place in it,
    // whoever the customer is. The old per-code counters would hand back a
    // number already in use, so they are cleared.
    await client.query(
      `INSERT INTO counters (scope, last_value) VALUES ('INV', $1)
       ON CONFLICT (scope) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`,
      [rows.length])
    await client.query(`DELETE FROM counters WHERE scope LIKE 'INV:%'`)

    // ── Proof ─────────────────────────────────────────────────────────────
    const { rows: [check] } = await client.query(`
      SELECT count(*)::int AS live,
             count(*) FILTER (WHERE invoice_number ~ '^INV-2026-')::int AS still_on_the_old_scheme,
             count(*) FILTER (WHERE invoice_number !~ '^[A-Z]{3}-[0-9]{4}$')::int AS wrong_shape,
             count(DISTINCT invoice_number)::int AS distinct_numbers
        FROM invoices WHERE deleted_at IS NULL`)
    // One series now: 1 to N, no holes, and reading in date order.
    const { rows: [gaps] } = await client.query(`
      WITH n AS (
        SELECT CAST(SPLIT_PART(invoice_number, '-', 2) AS int) AS num,
               ROW_NUMBER() OVER (ORDER BY issue_date, created_at, id) AS by_date
          FROM invoices WHERE deleted_at IS NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]{4}$')
      SELECT (SELECT count(*) FROM n WHERE num <> by_date)::int
             + (SELECT CASE WHEN MIN(num) = 1 AND MAX(num) = count(*) THEN 0 ELSE 1 END FROM n)::int
             AS codes_with_a_hole`)

    const ok = check.still_on_the_old_scheme === 0 && check.wrong_shape === 0 &&
      check.distinct_numbers === check.live && gaps.codes_with_a_hole === 0
    console.log(`\n  live invoices: ${check.live}`)
    console.log(`  still on the old INV-2026 scheme: ${check.still_on_the_old_scheme}   ${check.still_on_the_old_scheme === 0 ? '✓' : '✗'}`)
    console.log(`  not shaped CCC-NNNN: ${check.wrong_shape}   ${check.wrong_shape === 0 ? '✓' : '✗'}`)
    console.log(`  every number unique: ${check.distinct_numbers === check.live ? 'yes' : 'no'}   ${check.distinct_numbers === check.live ? '✓' : '✗'}`)
    console.log(`  out of date order or with a hole: ${gaps.codes_with_a_hole}   ${gaps.codes_with_a_hole === 0 ? '✓' : '✗'}`)

    if (!ok) {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written.')
      process.exitCode = 1
      return
    }
    await client.query('COMMIT')

    const file = '/tmp/renumber-invoices-by-customer.json'
    fs.writeFileSync(file, JSON.stringify(moves.map(m => ({ from: m.invoice_number, to: m.to, customer: m.customer })), null, 2))
    console.log(`\nRenumbered ${moves.length} invoice(s). The old number of each is written to ${file}.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
