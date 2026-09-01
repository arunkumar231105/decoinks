/**
 * Invoice numbers: the buyer's letters, the book's number.
 *
 * An invoice number here is three letters and a number — RFA-0115, KMO-0110.
 * The letters name the customer: the first of their first name and the first
 * two of their surname, which is how the hundred-odd invoices raised by hand
 * are built, and why Chris Cox is CCO while Christine Calhoun is CCA.
 *
 * The number is NOT the customer's. It is one sequence for the whole book, in
 * date order, so the list reads 1 to N down the page whoever each invoice is
 * for. getNextInvoiceNumber in utils/counter.js has always done this correctly.
 * An earlier version of THIS script did not — it took the highest number under
 * each customer's own letters, so a new customer's first invoice came out as
 * TRA-0001 sitting between NSA-0098 and MNA-0094, and seventeen numbers ended
 * up used twice under different letters.
 *
 * So both halves are rebuilt: the letters from the customer, the number from
 * the invoice's place in date order. Renumbered in two passes, because the
 * unique index sees soft-deleted rows too and a number cannot be taken while
 * another row still holds it.
 *
 * This changes numbers on invoices that have already been issued. That is the
 * point — they are wrong — but it is worth knowing before running it.
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

  // Date order is what the list shows and sorts on; created_at then id break a
  // tie, so two invoices issued the same day keep the order they were written.
  const invoices = (await query(
    `SELECT i.id, i.invoice_number, i.issue_date,
            COALESCE(NULLIF(c.company_name,''), c.name, i.customer_name) AS customer
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.deleted_at IS NULL
      ORDER BY i.issue_date, i.created_at, i.id`)).rows

  const moves = invoices
    .map((inv, idx) => ({ ...inv, to: `${houseRule(inv.customer)}-${String(idx + 1).padStart(4, '0')}` }))
    .filter(m => m.to !== m.invoice_number)

  const wrongPrefix = moves.filter(m => m.invoice_number.slice(0, 3) !== m.to.slice(0, 3)).length

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${invoices.length} invoices, ${moves.length} ka number badlega ` +
              `(${wrongPrefix} ke letters bhi ghalat hain)\n`)
  for (const m of moves.slice(0, 15))
    console.log(`  ${String(m.issue_date).slice(0, 10)}  ${m.invoice_number.padEnd(10)} -> ${m.to.padEnd(10)}  ${m.customer}`)
  if (moves.length > 15) console.log(`  … aur ${moves.length - 15}`)
  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    // The unique index counts retired invoices too, so one that was deleted
    // while holding a number the live sequence now needs would block it. Their
    // number is kept readable but moved out of the pattern the book uses, so it
    // can never be handed out or counted again.
    const { rowCount: retired } = await query(
      `UPDATE invoices SET invoice_number = 'X-' || invoice_number
        WHERE deleted_at IS NOT NULL AND invoice_number ~ '^[A-Z]{3}-[0-9]+$'`)
    if (retired) console.log(`  ${retired} mitayi hui invoices ko raaste se hata diya`)

    // Park every number that is moving, so none of the new ones collides with a
    // number another row has not let go of yet.
    for (const m of moves)
      await query(`UPDATE invoices SET invoice_number = 'TMP-' || substr(replace(id::text,'-',''),1,16) WHERE id = $1`, [m.id])
    for (const m of moves)
      await query(`UPDATE invoices SET invoice_number = $2, updated_at = NOW() WHERE id = $1`, [m.id, m.to])

    const { rows: check } = await query(
      `WITH n AS (SELECT invoice_number,
                         NULLIF(split_part(invoice_number,'-',2),'')::INT AS num,
                         row_number() OVER (ORDER BY issue_date, created_at, id) AS want
                    FROM invoices WHERE deleted_at IS NULL)
       SELECT count(*)::INT AS docs, min(num) AS lo, max(num) AS hi,
              count(DISTINCT num)::INT AS distinct_nums,
              count(*) FILTER (WHERE num <> want)::INT AS out_of_place FROM n`)
    const c = check[0]
    const ok = c.lo === 1 && c.hi === c.docs && c.distinct_nums === c.docs && c.out_of_place === 0
    console.log(`\n  ${c.docs} invoices, ${c.lo}–${c.hi}, out of place ${c.out_of_place}, ` +
                `unique ${c.distinct_nums === c.docs ? 'yes' : 'no'}   ${ok ? '✓' : '✗'}`)
    if (!ok) throw new Error('numbering still not 1..N in date order — rolled back')
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  console.log('\nho gaya\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
