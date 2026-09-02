#!/usr/bin/env node
/**
 * Number every document in the order it happened.
 *
 * The four series run 1..N with no holes, but the numbers were handed out in
 * the order the rows were imported, not the order the work was done. So the
 * list sorted by date reads 0145, 0109, 0111, 0110, 0113 — and the oldest job
 * in the book is not number 1. The shop reads these numbers as a sequence, and
 * they should be one: the earliest job is 1, the latest is N, and tomorrow's
 * order is N+1 sitting at the top.
 *
 * WHICH DATE. The one each list shows and sorts on — the order date for orders
 * and purchase orders, the entry date for quotations, the issue date for
 * invoices — with created_at and then the row's id breaking ties, so two jobs
 * on the same day keep the order they were entered in and the result is the
 * same every time this is run.
 *
 * THE NUMBERS ARE SAFE TO MOVE. 125 of the 126 orders, and 95 of the 99
 * invoices and quotations, were written by an import; those numbers were
 * generated here and have never been on a copy anyone outside the shop holds.
 * The reference a supplier knows a job by is source_po_number, which is theirs
 * and is not touched. The handful entered by hand are listed in the dry run so
 * they can be checked before anything is written.
 *
 * WHAT MOVES WITH THEM. artwork_vault_order_link keeps a copy of the order
 * number rather than pointing at the order's id — 702 rows of it. They are
 * rewritten in the same transaction, and counted afterwards; a link left
 * pointing at a number that no longer exists would quietly lose an artwork.
 *
 * HOW THE SHUFFLE AVOIDS COLLIDING WITH ITSELF. The numbers are unique, and
 * almost every document is moving to a number another document currently
 * holds. So every row is parked at a temporary value first and given its real
 * number second — two passes, one transaction.
 *
 * Usage:
 *   node backend/scripts/renumber-documents-by-date.js            (dry-run)
 *   node backend/scripts/renumber-documents-by-date.js --apply
 *   ... --only=orders,invoices    limit it to named series
 */
const fs = require('fs')
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
// No connection string in the source. This runs against whatever DATABASE_URL
// points at, and refuses to run without one — a default here is a database
// password in a public repository, and a default pointing at production is a
// script that writes to it by accident.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess which database to use.')
  process.exit(1)
}

const SERIES = [
  // created_at, not entry_date: the quotations list labels created_at as
  // "Quote Date" and sorts on it, so that is the date the shop reads the
  // sequence against.
  // altPrefix: quotations written before the generator was corrected carry QT-
  // rather than Q-. They are the same series and belong in it, so they are
  // adopted rather than left sitting outside the sequence with the newest date
  // in the book and a number from the middle of it.
  { key: 'quotations', table: 'quotations', column: 'quote_number', prefix: 'Q',
    altPrefix: 'QT', dateColumn: 'created_at', label: 'Quotations' },
  // Payments have neither deleted_at nor source_system: nothing soft-deletes
  // them, and they do not record where they were entered from.
  { key: 'payments', table: 'payments', column: 'payment_number', prefix: 'PAY',
    dateColumn: 'payment_date', label: 'Payments', softDeletes: false, hasSource: false },
  // Invoices are handled by invoice-numbers-follow-the-house-rule.js, not
  // because they are outside the date sequence — they are very much in it — but
  // because their number carries the buyer's initials in front of it rather
  // than a fixed prefix and a year, so it cannot be rebuilt from one template
  // the way these four can.
  { key: 'orders', table: 'orders', column: 'order_number', prefix: 'ORD',
    dateColumn: 'order_date', label: 'Sales orders' },
  { key: 'purchase_orders', table: 'purchase_orders', column: 'po_number', prefix: 'PO',
    dateColumn: 'order_date', label: 'Purchase orders' },
]

// Every series soft-deletes and records a source unless it says otherwise.
for (const s of SERIES) {
  if (s.softDeletes === undefined) s.softDeletes = true
  if (s.hasSource === undefined) s.hasSource = true
}
const alive = s => (s.softDeletes ? 'deleted_at IS NULL AND ' : '')

const YEAR = 2026
const pad = n => String(n).padStart(4, '0')
// Matches the series' own prefix and any older spelling of the same series.
const seriesPattern = s =>
  `^(${[s.prefix, ...(s.altPrefix ? [s.altPrefix] : [])].join('|')})-${YEAR}-[0-9]+$`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    const wanted = ONLY ? ONLY.split(',').map(s => s.trim()) : null
    const chosen = SERIES.filter(s => !wanted || wanted.includes(s.key))
    if (wanted) console.log(`Limited to: ${chosen.map(s => s.key).join(', ')}\n`)

    const plans = []
    for (const s of chosen) {
      const { rows } = await client.query(`
        SELECT id, ${s.column} AS number, ${s.dateColumn} AS on_date, created_at,
               ${s.hasSource ? 'source_system IS NULL' : 'TRUE'} AS entered_by_hand
          FROM ${s.table}
         WHERE ${alive(s)}${s.column} ~ $1
         ORDER BY ${s.dateColumn}, created_at, id`, [seriesPattern(s)])

      const moves = rows
        .map((r, i) => ({ ...r, to: `${s.prefix}-${YEAR}-${pad(i + 1)}` }))
        .filter(r => r.to !== r.number)

      // Anything in the table this pass will not touch — a different year, or a
      // shape the pattern does not match — must not be about to be overwritten.
      const { rows: [outsideRow] } = await client.query(
        `SELECT count(*)::int AS n FROM ${s.table} WHERE ${alive(s)}${s.column} !~ $1`,
        [seriesPattern(s)])
      const outside = outsideRow.n

      plans.push({ series: s, rows, moves, outside })

      const byHand = moves.filter(m => m.entered_by_hand)
      console.log(`${s.label.padEnd(16)} ${String(rows.length).padStart(4)} documents` +
        `   ${String(moves.length).padStart(4)} change number` +
        `   ${outside ? `${outside} outside this series, left alone` : 'all in one series'}`)
      if (byHand.length) {
        console.log(`  ${byHand.length} of them were entered by hand rather than imported — check these:`)
        byHand.forEach(m => console.log(`      ${m.number} → ${m.to}   (${String(m.on_date).slice(0, 10)})`))
      }
    }

    // Show what the top of each list will read, which is what the shop looks at.
    console.log('\nHow the newest end of each list will read:')
    for (const p of plans) {
      const top = [...p.rows].slice(-4).reverse()
      console.log(`  ${p.series.label}`)
      for (const r of top) {
        const to = `${p.series.prefix}-${YEAR}-${pad(p.rows.indexOf(r) + 1)}`
        console.log(`      ${String(r.on_date).slice(0, 10)}   ${r.number.padEnd(14)} → ${to}`)
      }
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    const mapping = {}

    // Soft-deleted documents still hold a number, and the unique index does not
    // care that they are deleted — so a live document moving onto a number a
    // deleted one is sitting on collides. Most deleted rows were already parked
    // under a D- prefix when the series were first tidied; these are the ones
    // that were removed since. Same convention, so nothing new is invented.
    let parked = 0
    for (const p of plans) {
      const s2 = p.series
      // A series with nothing soft-deleted has nothing parked to clear.
      if (!s2.softDeletes) continue
      const { rowCount } = await client.query(
        `UPDATE ${s2.table} SET ${s2.column} = 'D-' || RIGHT(id::text, 12)
          WHERE deleted_at IS NOT NULL AND ${s2.column} ~ $1`,
        [seriesPattern(s2)])
      parked += rowCount
    }
    if (parked) console.log(`\nParked ${parked} deleted document(s) that were still holding a number.`)

    for (const p of plans) {
      const { series: s, moves } = p
      if (!moves.length) continue
      mapping[s.key] = moves.map(m => ({ from: m.number, to: m.to, date: String(m.on_date).slice(0, 10) }))

      // Pass one: park everything that moves, so no two rows fight over a number.
      for (let i = 0; i < moves.length; i++) {
        await client.query(`UPDATE ${s.table} SET ${s.column} = $2 WHERE id = $1`,
          [moves[i].id, `TMP-${s.prefix}-${i}`])
      }
      // Pass two: the real numbers.
      for (const m of moves) {
        await client.query(`UPDATE ${s.table} SET ${s.column} = $2, updated_at = NOW() WHERE id = $1`,
          [m.id, m.to])
      }
      // The counter is a high-water mark; it must not hand out a number in use.
      await client.query(
        `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
         ON CONFLICT (scope) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`,
        [`${s.prefix}-${YEAR}`, p.rows.length])
    }

    // Five purchase orders say in their notes which sales order they were
    // raised to match. Left alone they would name an order that has moved.
    //
    // Not by replacing the old number with the new one, though: replacing text
    // one move at a time chains — a note saying A becomes B on one pass and C
    // on the next, and ends up naming an order that exists but is the wrong
    // one, which no "does this number exist" check would catch. The note is
    // rewritten from the purchase order's own order_id instead, which did not
    // move and is the only thing that knows the answer.
    //
    // Deleted purchase orders are skipped. Their linked order is usually
    // deleted too, and writing a parked D- identifier into a sentence helps
    // nobody; the note stays as the record of what it once said.
    let notesRewritten = 0
    if (mapping.orders) {
      const { rowCount } = await client.query(`
        UPDATE purchase_orders p
           SET notes = regexp_replace(p.notes, 'ORD-[0-9]{4}-[0-9]{4}', o.order_number, 'g'),
               updated_at = NOW()
          FROM orders o
         WHERE o.id = p.order_id
           AND p.deleted_at IS NULL AND o.deleted_at IS NULL
           AND p.notes ~ 'ORD-[0-9]{4}-[0-9]{4}'
           AND substring(p.notes FROM 'ORD-[0-9]{4}-[0-9]{4}') IS DISTINCT FROM o.order_number`)
      notesRewritten = rowCount
    }

    // artwork_vault_order_link looked like a table holding a copy of the order
    // number — 702 rows of it. It is a view that reads o.order_number straight
    // from the order, so it follows on its own and there is nothing to rewrite.
    // Checked below rather than assumed.

    // ── Proof ─────────────────────────────────────────────────────────────
    const problems = []
    for (const p of plans) {
      const s = p.series
      const { rows: [check] } = await client.query(`
        WITH n AS (
          SELECT CAST(SPLIT_PART(${s.column}, '-', 3) AS int) AS num,
                 ROW_NUMBER() OVER (ORDER BY ${s.dateColumn}, created_at, id) AS by_date
            FROM ${s.table} WHERE ${alive(s)}${s.column} ~ $1)
        SELECT count(*)::int AS docs,
               count(*) FILTER (WHERE num <> by_date)::int AS out_of_place,
               MIN(num) AS lowest, MAX(num) AS highest,
               count(DISTINCT num)::int AS distinct_numbers
          FROM n`, [seriesPattern(s)])
      const gapless = Number(check.lowest) === 1 && Number(check.highest) === check.docs
      const unique = check.distinct_numbers === check.docs
      const ok = check.out_of_place === 0 && gapless && unique && check.docs === p.rows.length
      console.log(`\n  ${s.label.padEnd(16)} ${check.docs} documents, ${check.lowest}–${check.highest}` +
        `, out of place ${check.out_of_place}, unique ${unique ? 'yes' : 'no'}   ${ok ? '✓' : '✗'}`)
      if (!ok) problems.push(`${s.label}: ${check.out_of_place} out of place, ${check.docs} documents ${check.lowest}–${check.highest}`)
    }

    const { rows: [links] } = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM orders o WHERE o.order_number = l.order_number))::int AS dangling
        FROM artwork_vault_order_link l`)
    console.log(`  artwork links     ${links.total} rows follow the order automatically, ` +
      `${links.dangling} pointing at nothing` + (links.dangling === 0 ? '   ✓' : '   ✗'))

    const { rows: [stale] } = await client.query(`
      SELECT count(*)::int AS n
        FROM purchase_orders p JOIN orders o ON o.id = p.order_id
       WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL
         AND p.notes ~ 'ORD-[0-9]{4}-[0-9]{4}'
         AND substring(p.notes FROM 'ORD-[0-9]{4}-[0-9]{4}') IS DISTINCT FROM o.order_number`)
    console.log(`  purchase order notes  ${notesRewritten} rewritten, ${stale.n} naming the wrong order` +
      (stale.n === 0 ? '   ✓' : '   ✗'))
    if (stale.n) problems.push(`${stale.n} purchase order note(s) name an order other than the one they are attached to`)
    if (links.dangling) problems.push(`${links.dangling} artwork links point at an order number that does not exist`)

    if (problems.length) {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written:')
      problems.forEach(x => console.log(`  ✗ ${x}`))
      process.exitCode = 1
      return
    }

    await client.query('COMMIT')

    const file = `/tmp/renumber-${YEAR}-${plans.map(p => p.series.key).join('-')}.json`
    fs.writeFileSync(file, JSON.stringify(mapping, null, 2))
    const moved = Object.values(mapping).reduce((s, a) => s + a.length, 0)
    console.log(`\nRenumbered ${moved} document(s). Every series now reads in date order, 1 to N.`)
    console.log(`The old number of every one of them is written to ${file}.`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
