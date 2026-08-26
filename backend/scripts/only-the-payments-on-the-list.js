/**
 * The mailbox file is the record of what was actually received. Anything in the
 * payments table that is not on it was invented by the software — when a sales
 * order is saved with payment details it quietly writes a payment of its own —
 * and those are duplicates of money already recorded.
 *
 * So: every deposit on the list is matched to its payment, and whatever is left
 * over is removed. Then the numbers are reissued in date order, oldest first,
 * because deleting rows leaves holes in the sequence.
 *
 * Dry run by default. Pass --apply to write.
 */
const fs = require('fs')
const { query, pool } = require('../src/config/db')

const STOP = new Set(['llc','inc','ltd','co','corp','the','and','intl','international','jr','sr'])
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g,' ')
  .split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w))
const agree = (a, b) => { const x = words(a), y = words(b); return x.length && y.length && x.some(w => y.includes(w)) }
const money = n => `$${Number(n).toFixed(2)}`
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000)

async function main() {
  const apply = process.argv.includes('--apply')
  const sheet = fs.readFileSync(`${__dirname}/data/verified-deposits.tsv`, 'utf8')
    .split('\n').filter(Boolean).map(l => {
      const [date, provider, type, payer, amount] = l.split('\t')
      return { date, payer, amount: Number(amount) }
    })

  const rows = (await query(
    `SELECT id, COALESCE(NULLIF(payment_number,''),'(no number)') AS pno, payment_date, amount,
            COALESCE(received_from_name,'') AS payer, order_id, invoice_id,
            COALESCE(notes,'') AS notes
       FROM payments ORDER BY payment_date, created_at`)).rows

  const keep = new Set()
  for (const d of sheet) {
    const hit = rows.find(r => {
      if (keep.has(r.id)) return false
      if (Math.abs(Number(r.amount) - d.amount) >= 0.005) return false
      const same = r.payer ? agree(r.payer, d.payer) : false
      if (days(r.payment_date, d.date) > (same ? 14 : 3)) return false
      return !r.payer || same
    })
    if (hit) keep.add(hit.id)
  }
  const drop = rows.filter(r => !keep.has(r.id))

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`list mein         ${sheet.length}`)
  console.log(`system mein       ${rows.length}`)
  console.log(`mil gayin         ${keep.size}`)
  console.log(`HATENGI           ${drop.length}   ${money(drop.reduce((s, r) => s + Number(r.amount), 0))}\n`)
  for (const r of drop)
    console.log(`  ${String(r.payment_date).slice(0,10)}  ${money(r.amount).padStart(10)}  ${r.pno.padEnd(16)} ${(r.payer || '(naam nahi)').padEnd(22)} ${r.order_id ? 'ORDER SE JUDI HAI' : ''} ${r.notes.slice(0,34)}`)

  if (sheet.length !== keep.size)
    console.log(`\n⚠ list ki ${sheet.length - keep.size} payments system mein nahi mileen — pehle wo daalein`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const r of drop) {
      await query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [r.id])
      await query(`DELETE FROM payments WHERE id = $1`, [r.id])
    }
    // Reissue numbers in date order so the list reads 1..N with no holes.
    // Parked first: the unique index spans every row, so a straight renumber
    // would collide with a number still held by another payment.
    // 16 hex characters of the id — unique, and inside the column's 30.
    await query(`UPDATE payments SET payment_number = 'TMP-' || substr(replace(id::text,'-',''), 1, 16)`)
    const left = (await query(
      `SELECT id FROM payments ORDER BY payment_date, created_at, id`)).rows
    let n = 0
    for (const p of left) {
      n++
      await query(`UPDATE payments SET payment_number = $2, updated_at = NOW() WHERE id = $1`,
        [p.id, `PAY-2026-${String(n).padStart(4, '0')}`])
    }
    await query('COMMIT')
    console.log(`\n${drop.length} payments hata di gayin, ${n} ko naye number mil gaye.\n`)
  } catch (e) { await query('ROLLBACK'); throw e }
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
