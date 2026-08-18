#!/usr/bin/env node
/**
 * Make every document series run 1..N with no holes.
 *
 * Rows get deleted, and rows arrive from flows that number them their own way,
 * so the series drift: 57 customers numbered up to 0084, 99 shipments numbered
 * up to 0102, six quotations carrying a QT- prefix among ninety-five Q- ones,
 * five invoices named after their customer, one payment with no number at all.
 *
 * Each series is renumbered 1..N per year with the least possible movement:
 * rows keep the order they are already in — sorted by the number they already
 * carry — and only the ones after a hole move down. Rows whose number is not in
 * the series' canonical shape are slotted in after the numbered ones, oldest
 * first, so nothing already-numbered is disturbed on their account. Orders and
 * purchase orders are already 1..97 and come out unchanged.
 *
 * Renaming runs in two passes (park at T-n first) so a target number can never
 * collide with a row still holding it, and soft-deleted rows are parked under a
 * D- prefix, matching fix-dates-and-renumber.js.
 *
 * The counters high-water mark is brought down to the new top of each series —
 * numbers are issued from it, so leaving it high would reopen the same holes on
 * the very next document.
 *
 * WHAT THIS CANNOT FIX FROM THE DATA SIDE: two generators will keep producing
 * out-of-series numbers until they are changed in code (both live in files the
 * Constitution protects, so they are left alone here):
 *   - quotations.service.js asks for the 'QT' prefix, while the series is Q-.
 *   - counter.js getNextInvoiceNumber() numbers invoices per customer
 *     (MACDUMAS-0001), by design, rather than INV-YYYY-NNNN.
 *
 * Usage:
 *   node backend/scripts/close-all-number-gaps.js            (dry-run)
 *   node backend/scripts/close-all-number-gaps.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// prefix = the canonical shape of the series; dateCol decides a row's year when
// its number does not say, and orders the rows that fall outside the shape.
const SERIES = [
  { table: 'customers',       col: 'customer_number', prefix: 'CUST', dateCol: 'created_at',                        soft: true  },
  { table: 'quotations',      col: 'quote_number',    prefix: 'Q',    dateCol: 'COALESCE(sent_at, created_at)',     soft: true  },
  { table: 'invoices',        col: 'invoice_number',  prefix: 'INV',  dateCol: 'COALESCE(issue_date, created_at)',  soft: true  },
  { table: 'orders',          col: 'order_number',    prefix: 'ORD',  dateCol: 'COALESCE(order_date, created_at)',  soft: true  },
  { table: 'purchase_orders', col: 'po_number',       prefix: 'PO',   dateCol: 'COALESCE(order_date, created_at)',  soft: true  },
  { table: 'shipments',       col: 'shipment_number', prefix: 'SHP',  dateCol: 'COALESCE(ship_date, created_at)',   soft: true  },
  { table: 'payments',        col: 'payment_number',  prefix: 'PAY',  dateCol: 'COALESCE(payment_date, created_at)', soft: false },
]

async function plan(client, s) {
  const live = s.soft ? 'WHERE deleted_at IS NULL' : ''
  const { rows } = await client.query(
    `SELECT id, ${s.col} AS num,
            (${s.col} ~ ('^' || $1 || '-[0-9]{4}-[0-9]{4}$')) AS canonical,
            CASE WHEN ${s.col} ~ ('^' || $1 || '-[0-9]{4}-[0-9]{4}$')
                 THEN substring(${s.col} from '-([0-9]{4})-')::int
                 ELSE EXTRACT(YEAR FROM ${s.dateCol})::int END AS yr,
            CASE WHEN ${s.col} ~ ('^' || $1 || '-[0-9]{4}-[0-9]{4}$')
                 THEN SPLIT_PART(${s.col}, '-', 3)::int ELSE NULL END AS seq,
            ${s.dateCol} AS dt
       FROM ${s.table} ${live}
      ORDER BY yr, canonical DESC NULLS LAST, seq NULLS LAST, dt NULLS LAST, created_at`,
    [s.prefix])

  const counter = {}
  const moves = []
  for (const r of rows) {
    counter[r.yr] = (counter[r.yr] || 0) + 1
    const next = `${s.prefix}-${r.yr}-${String(counter[r.yr]).padStart(4, '0')}`
    if (next !== r.num) moves.push({ id: r.id, from: r.num ?? '(no number)', to: next })
  }
  return { rows, counter, moves }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const all = []
    for (const s of SERIES) {
      const p = await plan(client, s)
      all.push({ s, ...p })
      const years = Object.entries(p.counter).map(([y, n]) => `${y}: 1..${n}`).join(', ')
      console.log(`${s.table.padEnd(16)} ${String(p.rows.length).padStart(4)} rows → ${years}` +
        `   ${p.moves.length ? `${p.moves.length} number(s) change` : 'already sequential ✓'}`)
      p.moves.slice(0, 12).forEach(m => console.log(`      ${m.from} → ${m.to}`))
      if (p.moves.length > 12) console.log(`      … and ${p.moves.length - 12} more`)
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    for (const { s, counter, moves } of all) {
      if (s.soft) {
        await client.query(
          `UPDATE ${s.table} SET ${s.col} = 'D-' || RIGHT(id::text, 12)
            WHERE deleted_at IS NOT NULL AND ${s.col} NOT LIKE 'D-%'`)
      }
      for (let i = 0; i < moves.length; i++) {
        await client.query(`UPDATE ${s.table} SET ${s.col} = $2 WHERE id = $1`, [moves[i].id, `T-${i}`])
      }
      for (const m of moves) {
        await client.query(`UPDATE ${s.table} SET ${s.col} = $2, updated_at = NOW() WHERE id = $1`, [m.id, m.to])
      }
      for (const [yr, last] of Object.entries(counter)) {
        await client.query(
          `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
           ON CONFLICT (scope) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`,
          [`${s.prefix}-${yr}`, last])
      }
    }
    await client.query('COMMIT')

    console.log('\nDone. Verifying…')
    for (const { s } of SERIES.map(s => ({ s }))) {
      const live = s.soft ? 'WHERE deleted_at IS NULL' : ''
      const { rows: [v] } = await client.query(
        `SELECT count(*)::int AS rows,
                count(*) FILTER (WHERE ${s.col} ~ ('^' || $1 || '-[0-9]{4}-[0-9]{4}$'))::int AS canonical,
                max(SPLIT_PART(${s.col}, '-', 3)::int) AS highest
           FROM ${s.table} ${live}`, [s.prefix])
      const ok = v.rows === v.canonical && v.rows === v.highest
      console.log(`  ${s.table.padEnd(16)} ${v.rows} rows, all numbered ${v.canonical === v.rows ? 'yes' : 'NO'}, ` +
        `highest ${v.highest}  ${ok ? '✓' : '← check (a second year in this series is normal)'}`)
    }
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
