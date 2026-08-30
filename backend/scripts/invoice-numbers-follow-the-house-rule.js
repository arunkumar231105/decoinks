/**
 * The invoices raised by every-order-gets-its-quote-and-invoice.js were numbered
 * from the first three letters of the whole name (Robert Farrar -> ROB). The
 * house rule, read off the 100-odd invoices raised by hand, is the first letter
 * of the first name plus the first two of the surname (-> RFA). It matters:
 * under my rule Chris Cox and Christine Calhoun both become CHR, while the house
 * rule keeps them apart as CCO and CCA.
 *
 * Renumbered in two passes — the unique index sees soft-deleted rows too, so
 * every number is parked under TMP- before the real one is taken.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

function houseRule(name) {
  const words = String(name || '').replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'CUS'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase().padEnd(3, 'X')
  return (words[0][0] + words[words.length - 1].slice(0, 2)).toUpperCase().padEnd(3, 'X')
}

async function main() {
  const apply = process.argv.includes('--apply')
  const mine = (await query(
    `SELECT i.id, i.invoice_number, COALESCE(NULLIF(c.company_name,''), c.name) AS customer
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.deleted_at IS NULL AND i.notes LIKE 'Raised from ORD-%'
      ORDER BY i.issue_date, i.invoice_number`)).rows

  // Highest number already taken per prefix, counting soft-deleted rows, so a
  // reissued number can never collide with a retired invoice.
  const highest = new Map()
  for (const r of (await query(
    `SELECT split_part(invoice_number,'-',1) AS prefix,
            MAX(NULLIF(split_part(invoice_number,'-',2),'')::INT) AS top
       FROM invoices WHERE invoice_number ~ '^[A-Z]{3}-[0-9]+$' GROUP BY 1`)).rows)
    highest.set(r.prefix, Number(r.top) || 0)

  const moves = []
  for (const inv of mine) {
    const prefix = houseRule(inv.customer)
    const next = (highest.get(prefix) || 0) + 1
    highest.set(prefix, next)
    const to = `${prefix}-${String(next).padStart(4, '0')}`
    if (to !== inv.invoice_number) moves.push({ ...inv, to })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN'} — ${moves.length} invoice number badlenge\n`)
  for (const m of moves) console.log(`  ${m.invoice_number.padEnd(10)} -> ${m.to.padEnd(10)}  ${m.customer}`)
  if (!apply) { console.log('\nLikhne ke liye --apply.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const m of moves)
      await query(`UPDATE invoices SET invoice_number = 'TMP-' || substr(replace(id::text,'-',''),1,16) WHERE id = $1`, [m.id])
    for (const m of moves)
      await query(`UPDATE invoices SET invoice_number = $2, updated_at = NOW() WHERE id = $1`, [m.id, m.to])
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }
  console.log('\nhogaya\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
