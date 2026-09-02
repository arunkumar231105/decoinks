/**
 * Is every document series still 1 to N, in date order, with nothing repeated?
 *
 * The application itself cannot break this: getNextNumber and
 * getNextInvoiceNumber both take an advisory lock and seed from the highest
 * number already in the table, so a document raised through the app always
 * continues the sequence. What breaks it is a bulk script — one that fed rows
 * straight in, or renumbered them on a rule that was not the shop's.
 *
 * That is exactly how invoices went wrong: a script took the highest number
 * under each customer's own letters instead of the highest in the book, so a
 * new customer's first invoice came out 0001 and seventeen numbers ended up
 * used twice. Nothing noticed until someone read the list.
 *
 * So run this after any bulk feed, merge or renumber. It writes nothing and
 * exits non-zero when a series is out, which is enough to stop a script that
 * chains onto it.
 */
const { query, pool } = require('../src/config/db')

const SERIES = [
  { label: 'Sales orders',    table: 'orders',          column: 'order_number',   date: 'order_date',   part: 3, soft: true },
  { label: 'Quotations',      table: 'quotations',      column: 'quote_number',   date: 'created_at',   part: 3, soft: true },
  { label: 'Purchase orders', table: 'purchase_orders', column: 'po_number',      date: 'order_date',   part: 3, soft: true },
  { label: 'Payments',        table: 'payments',        column: 'payment_number', date: 'payment_date', part: 3, soft: false },
  // The buyer's letters in front, so the number is the second part, not the third.
  { label: 'Invoices',        table: 'invoices',        column: 'invoice_number', date: 'issue_date',   part: 2, soft: true },
]

async function main() {
  let bad = 0
  console.log('')
  for (const s of SERIES) {
    const alive = s.soft ? 'WHERE deleted_at IS NULL' : ''
    const { rows } = await query(
      `WITH n AS (
         SELECT ${s.column} AS number,
                NULLIF(split_part(${s.column}, '-', ${s.part}), '')::INT AS num,
                row_number() OVER (ORDER BY ${s.date}, created_at, id) AS want
           FROM ${s.table} ${alive})
       SELECT count(*)::INT AS docs, min(num) AS lo, max(num) AS hi,
              count(DISTINCT num)::INT AS uniq,
              count(*) FILTER (WHERE num IS NULL)::INT AS unreadable,
              count(*) FILTER (WHERE num <> want)::INT AS out_of_place
         FROM n`)
    const c = rows[0]
    const gapless = Number(c.lo) === 1 && Number(c.hi) === c.docs
    const ok = gapless && c.uniq === c.docs && c.out_of_place === 0 && c.unreadable === 0
    if (!ok) bad++
    console.log(`  ${s.label.padEnd(16)} ${String(c.docs).padStart(4)} documents, ${c.lo}–${c.hi}, ` +
                `out of place ${String(c.out_of_place).padStart(3)}, ` +
                `unique ${c.uniq === c.docs ? 'yes' : 'NO '}   ${ok ? '✓' : '✗'}`)
  }
  console.log(bad ? `\n${bad} series out of order.\n` : '\nEvery series reads 1 to N in date order.\n')
  await pool.end()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
