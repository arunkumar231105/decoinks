/**
 * Wo payments hata dena jo kisi sales order se lagi hui nahi.
 *
 * Owner ka faisla: payments table mein sirf wahi rehni chahiyen jo kisi order
 * par lagi hain. Jin 9 orders ki payment abhi nahi mili, unki payment jab
 * milegi tab naye sire se daali jayegi.
 *
 * MITANE SE PEHLE YEH JAAN LEIN — 22 mein teen alag kism hain:
 *
 *   7  Stripe payouts aur Muhammad Usama ke internal transfers ($3,116.78).
 *      Yeh customer ka paisa hai hi nahi, bank ki apni harkat hai.
 *
 *   3  Robert Farrar ke ($461.25). Yeh paisa waqai aaya — mailbox file mein
 *      bhi hai aur chat mein bhi ("All paid!"). Magar uska maal ORD-2026-0086
 *      ke 167 transfers mein pehle se hai, is liye yeh ZYADA diya hua paisa
 *      hai. Isay mitane ka matlab hai us qarz ka record mit jana jo uska
 *      hum par banta hai. Backup table ise mehfooz rakhti hai.
 *
 *  12  Asal customer deposits ($645.80) — Darcy Lovell $155, Brent Luck $169,
 *      Ezra Keawe, Pride & Culture LLC waghera. Yeh sab owner ki apni tasdeeq
 *      shuda mailbox file se aaye the.
 *
 * Har row poori ki poori (to_jsonb) backup table mein jati hai, is liye yeh
 * kaam wapas laya ja sakta hai. Wapas laane ka tareeqa neeche likha hai.
 *
 * Sirf wahi mitengi jinka order_id khali hai. Kisi lagi hui payment ko haath
 * nahi lagta — script pehle ginti karti hai aur farq aane par ruk jati hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'loose_payments_removed_20260825'
const money = n => `$${Number(n).toFixed(2)}`

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const { rows } = await query(`
    SELECT p.id, p.payment_number, p.payment_date::date AS d, p.amount, p.payment_method,
           COALESCE(p.received_from_name, p.customer_name, '—') AS payer,
           CASE WHEN COALESCE(p.notes,'') LIKE '%NAHI%' THEN 'bank ki apni harkat'
                WHEN p.received_from_name = 'Artistic Tees' THEN 'Robert Farrar — zyada diya hua'
                ELSE 'asal customer deposit' END AS kism
      FROM payments p WHERE p.order_id IS NULL
     ORDER BY kism, p.payment_date`)

  if (!rows.length) { console.log('\nKoi loose payment nahi — karne ko kuch nahi.\n'); await pool.end(); return }

  // Allocations kisi par lagi hui ho to rukna.
  const alloc = await one(
    `SELECT COUNT(*) AS n FROM payment_allocations a WHERE a.payment_id = ANY($1)`,
    [rows.map(r => r.id)])
  if (Number(alloc.n)) {
    console.log(`\n${alloc.n} allocations in payments par lagi hui hain — mitana mehfooz nahi. Ruk raha hoon.\n`)
    await pool.end(); return
  }

  console.log(`\n${apply ? 'MITA RAHA HOON' : 'DRY RUN — kuch nahi mitega'}\n`)
  let kism = ''
  for (const r of rows) {
    if (r.kism !== kism) { kism = r.kism; console.log(`\n  — ${kism} —`) }
    console.log(`  ${r.payment_number}  ${r.d}  ${money(r.amount).padStart(9)}  ${String(r.payment_method).padEnd(14)} ${r.payer}`)
  }

  const byKind = {}
  for (const r of rows) { byKind[r.kism] = (byKind[r.kism] || 0) + Number(r.amount) }
  console.log('')
  for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: ${money(v)}`)
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)

  const before = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE order_id IS NOT NULL) AS linked FROM payments`)
  console.log(`\nmitengi: ${rows.length} payments, kul ${money(total)}`)
  console.log(`payments ${before.n} → ${Number(before.n) - rows.length}   (lagi hui ${before.linked} sab mehfooz)`)
  console.log(`\nWapas laane ke liye:`)
  console.log(`  INSERT INTO payments SELECT (jsonb_populate_record(NULL::payments, row_data)).* FROM ${BACKUP};\n`)

  if (!apply) { console.log('Mitane ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    payment_number text, kism text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  for (const r of rows) {
    const snap = await one(`SELECT to_jsonb(p) AS j FROM payments p WHERE p.id=$1`, [r.id])
    await query(`INSERT INTO ${BACKUP} (payment_number, kism, row_data) VALUES ($1,$2,$3)`,
      [r.payment_number, r.kism, snap.j])
  }

  const del = await query(`DELETE FROM payments WHERE order_id IS NULL`)
  const saved = await one(`SELECT COUNT(*) AS n FROM ${BACKUP}`)
  if (Number(saved.n) < rows.length) throw new Error('backup adhoori hai — rollback karein')

  const after = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE order_id IS NOT NULL) AS linked,
                                  COUNT(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL) AS orders
                             FROM payments`)
  console.log(`\n${del.rowCount} payments mit gayin, ${saved.n} backup mein mehfooz hain.`)
  console.log(`ab ${after.n} payments — sab ki sab lagi hui (${after.linked} payments, ${after.orders} orders).`)
  console.log(`\nWapas laane ke liye:`)
  console.log(`  INSERT INTO payments SELECT (jsonb_populate_record(NULL::payments, row_data)).* FROM ${BACKUP};\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
