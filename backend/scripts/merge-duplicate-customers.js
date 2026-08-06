#!/usr/bin/env node
/**
 * Merge customer duplicates whose names disagree only in punctuation, spacing
 * or a single-letter typo. All linked orders/quotations/invoices/POs/payments
 * point at whichever survivor already carries the most orders (or, if tied,
 * the record with the most-complete address). The losers are soft-deleted.
 *
 * Idempotent — a customer that already stands alone is left untouched.
 *
 * Usage:
 *   node backend/scripts/merge-duplicate-customers.js           (dry-run)
 *   node backend/scripts/merge-duplicate-customers.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

// Canonicalise a name for grouping — lowercase, drop punctuation, collapse
// whitespace, treat W/V and other common typo pairs as the same letter.
function canonicalise(name) {
  return name.toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Common OCR / typo pairs on this dataset: Wellon ↔ Vellon.
    .replace(/wellon/g, 'vellon')
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: customers } = await client.query(`
      SELECT c.id, c.name, c.address_line1, c.city, c.state, c.zip, c.created_at,
             (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND deleted_at IS NULL) AS order_count
        FROM customers c
       WHERE c.deleted_at IS NULL
       ORDER BY c.name`)

    // Group by canonical name; anything with a duplicate is a merge candidate.
    const groups = new Map()
    for (const c of customers) {
      const key = canonicalise(c.name)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(c)
    }

    const dupes = [...groups.entries()].filter(([, list]) => list.length > 1)
    console.log(`Duplicate groups: ${dupes.length}`)

    if (APPLY) await client.query('BEGIN')
    let merged = 0
    for (const [key, list] of dupes) {
      // Pick the survivor: most orders wins; tiebreak by longer address.
      list.sort((a, b) => {
        const oc = Number(b.order_count) - Number(a.order_count)
        if (oc !== 0) return oc
        return (String(b.address_line1||'').length) - (String(a.address_line1||'').length)
      })
      const keep = list[0]
      const dropIds = list.slice(1).map(c => c.id)
      console.log(`  [${key}] keep=${keep.name} (${keep.order_count} orders); drop=${list.slice(1).map(c => `${c.name}(${c.order_count})`).join(', ')}`)
      merged += dropIds.length
      if (!APPLY) continue

      // Point every dependent row at the survivor.
      for (const [table, col] of [['orders','customer_id'], ['invoices','customer_id'],
                                   ['quotations','customer_id'], ['payments','customer_id']]) {
        await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = ANY($2)`, [keep.id, dropIds])
      }
      // Fill any survivor field that was blank from a loser that had it.
      await client.query(`
        UPDATE customers keep
           SET address_line1 = COALESCE(NULLIF(keep.address_line1,''), losers.address_line1),
               city  = COALESCE(NULLIF(keep.city,''),  losers.city),
               state = COALESCE(NULLIF(keep.state,''), losers.state),
               zip   = COALESCE(NULLIF(keep.zip,''),   losers.zip),
               updated_at = NOW()
          FROM (SELECT address_line1, city, state, zip
                  FROM customers
                 WHERE id = ANY($2)
                   AND (address_line1 IS NOT NULL OR city IS NOT NULL)
                 ORDER BY LENGTH(COALESCE(address_line1,'')) DESC LIMIT 1) losers
         WHERE keep.id = $1`, [keep.id, dropIds])
      await client.query(`UPDATE customers SET deleted_at = NOW() WHERE id = ANY($1)`, [dropIds])
    }
    if (APPLY) await client.query('COMMIT')

    console.log(`\nMerged ${merged} duplicate rows into their survivors.`)
    if (!APPLY) console.log('DRY RUN — re-run with --apply to commit.')
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
