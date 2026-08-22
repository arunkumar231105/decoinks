#!/usr/bin/env node
/**
 * Move invoice numbers onto the three-letter customer code.
 *
 * Invoices used to be numbered with the customer's whole name —
 * HECTORGARCIA-0004 — which is a sentence, not a document number. counter.js now
 * builds a three-letter code instead (first letter of the given name plus the
 * first two of the family name: HGA). This brings the invoices already written
 * under the old scheme onto the new one, and clears the counter scopes the old
 * scheme left behind.
 *
 * The sequence number never changes: HECTORGARCIA-0004 becomes HGA-0004. Only
 * the prefix is shortened, so nothing that refers to "invoice four for Hector"
 * stops being true.
 *
 * Counters are high-water marks keyed by scope. A row is written for the new
 * scope at the highest number that code now holds, so the next invoice for that
 * customer carries on from where the old scheme stopped rather than restarting
 * at 0001. The old long-name scopes are then removed.
 *
 * Aborts rather than guessing if a new number is already taken.
 *
 * Usage:
 *   node backend/scripts/shorten-invoice-prefixes.js            (dry-run)
 *   node backend/scripts/shorten-invoice-prefixes.js --apply
 */
const { Pool } = require('pg')
const { buildInvoicePrefix } = require('../src/utils/counter')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    // Invoices numbered CUSTOMERNAME-NNNN (not the INV-YYYY-NNNN series, and not
    // a soft-deleted row already parked under D-).
    const { rows } = await client.query(
      `SELECT id, invoice_number, customer_name
         FROM invoices
        WHERE deleted_at IS NULL
          AND invoice_number ~ '^[A-Z0-9]+-[0-9]{4}$'
          AND invoice_number !~ '^INV-'
        ORDER BY invoice_number`)

    const moves = []
    for (const r of rows) {
      const seq = r.invoice_number.split('-').pop()
      const code = buildInvoicePrefix(r.customer_name || '')
      const next = `${code}-${seq}`
      if (next !== r.invoice_number) moves.push({ ...r, next, code, seq: Number(seq) })
    }

    console.log(`Invoices on the old long-name scheme: ${rows.length} — renaming ${moves.length}`)
    for (const m of moves) {
      console.log(`  ${m.invoice_number.padEnd(20)} → ${m.next.padEnd(10)} (${m.customer_name})`)
    }

    // A target number must not already belong to someone else.
    for (const m of moves) {
      const { rows: [clash] } = await client.query(
        `SELECT invoice_number FROM invoices WHERE invoice_number = $1 AND id <> $2`, [m.next, m.id])
      if (clash) throw new Error(`${m.invoice_number} → ${m.next} is already taken; aborting`)
    }

    const { rows: staleScopes } = await client.query(
      `SELECT scope, last_value FROM counters WHERE scope LIKE 'INV:%' AND length(scope) > 8 ORDER BY scope`)
    console.log(`\nCounter scopes left by the old scheme: ${staleScopes.length}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    await client.query('BEGIN')
    for (const m of moves) {
      await client.query(`UPDATE invoices SET invoice_number = $2, updated_at = NOW() WHERE id = $1`, [m.id, m.next])
    }

    // Seed each new code's scope at the highest number it now holds, so the next
    // invoice continues the customer's sequence instead of restarting.
    const codes = [...new Set(moves.map(m => m.code))]
    for (const code of codes) {
      const { rows: [top] } = await client.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 2) AS int)), 0) AS n
           FROM invoices WHERE invoice_number ~ ('^' || $1 || '-[0-9]+$')`, [code])
      await client.query(
        `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
         ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(counters.last_value, EXCLUDED.last_value), updated_at = NOW()`,
        [`INV:${code}`, top.n])
      console.log(`  counter INV:${code} → ${top.n}`)
    }

    const { rowCount: cleared } = await client.query(
      `DELETE FROM counters WHERE scope LIKE 'INV:%' AND length(scope) > 8`)
    await client.query('COMMIT')
    console.log(`\nRenamed ${moves.length} invoice(s); cleared ${cleared} stale counter scope(s).`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
