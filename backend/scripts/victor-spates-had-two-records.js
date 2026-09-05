/**
 * Victor Spates do baar darj hai. Ek ko doosre mein mila dena.
 *
 * Sab customers ka number ab CUST-2026-NNNN ki shakl mein hai — sirf ek ke
 * ilawa:
 *
 *   CUST-2026-0028        Victor Spates   4 orders, 4 quotes, 4 invoices, 3 payments
 *   CUST-CRM-D4D0F068E6   Victor Spates   0 orders, 0 quotes, 0 invoices, 1 payment, 1 lead
 *
 * Doosra CRM bridge se bana tha. Jab lead panel se koi customer banta hai to
 * wo Printshop ka apna counter istemal nahi karta, apna hi shanakhti number
 * gharh leta hai — is liye us par CUST-CRM- laga hai. Yeh naya gaahak nahi,
 * wahi Victor hai.
 *
 * Us par jo kuch laga hai wo asal record par bhej diya jata hai — ek payment
 * aur ek lead — phir duplicate hata diya jata hai. Number badalne ke bajaye
 * milana is liye theek hai ke asal record par kaam ki poori tareekh mojood hai;
 * dusra sirf ek payment ka khaana hai.
 *
 * PAYMENT KHULI RAHEGI. PAY-2026-0134 ($52, 4 September, Stripe) kisi order se
 * juri nahi — advance hai, invoice se pehle. Yahan sirf uska maalik theek hota
 * hai. Kaun se order ki hai, yeh owner hi bata sakta hai; qaida yeh hai ke ek
 * order ke saath ek hi payment lagti hai, is liye andaze se nahi lagai jati.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'victor_merge_backup_20260905'
const DUP  = 'CUST-CRM-D4D0F068E6'
const REAL = 'CUST-2026-0028'

async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }
async function all(sql, p) { const { rows } = await query(sql, p); return rows }

async function main() {
  const apply = process.argv.includes('--apply')

  const dup  = await one(`SELECT id, customer_number, name, email, phone FROM customers
                           WHERE customer_number=$1 AND deleted_at IS NULL`, [DUP])
  const real = await one(`SELECT id, customer_number, name FROM customers
                           WHERE customer_number=$1 AND deleted_at IS NULL`, [REAL])
  if (!dup)  { console.log(`${DUP} nahi mila — shayad pehle hi mil chuka hai.`); await pool.end(); return }
  if (!real) { console.log(`${REAL} nahi mila — ruk raha hoon.`); await pool.end(); return }
  if (dup.name.trim().toLowerCase() !== real.name.trim().toLowerCase()) {
    console.log(`naam mel nahi khate: "${dup.name}" aur "${real.name}" — ruk raha hoon.`)
    await pool.end(); return
  }

  // Jo bhi duplicate par laga hai. Orders/quotes/invoices sifar hone chahiye —
  // agar nahi hain to yeh sirf ek khaali khaana nahi, aur haath nahi lagta.
  const orders = await all(`SELECT order_number FROM orders WHERE customer_id=$1 AND deleted_at IS NULL`, [dup.id])
  const quotes = await all(`SELECT quote_number FROM quotations WHERE customer_id=$1 AND deleted_at IS NULL`, [dup.id])
  const invs   = await all(`SELECT invoice_number FROM invoices WHERE customer_id=$1 AND deleted_at IS NULL`, [dup.id])
  if (orders.length || quotes.length || invs.length) {
    console.log(`duplicate par kaam laga hua hai (${orders.length} orders, ${quotes.length} quotes, ` +
                `${invs.length} invoices) — milane se pehle inhein dekhna hoga.`)
    await pool.end(); return
  }

  const pays  = await all(`SELECT id, payment_number, payment_date::date AS d, amount, payment_method, order_id
                             FROM payments WHERE customer_id=$1 ORDER BY payment_number`, [dup.id])
  const leads = await all(`SELECT id, lead_number FROM leads WHERE customer_id=$1`, [dup.id])
  const addrs = await all(`SELECT id FROM customer_addresses WHERE customer_id=$1`, [dup.id])

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${dup.customer_number}  ${dup.name}   ->   ${real.customer_number}  ${real.name}`)
  for (const p of pays)
    console.log(`     payment ${p.payment_number}  ${p.d}  $${Number(p.amount).toFixed(2)}  ${p.payment_method}` +
                `${p.order_id ? '' : '   (kisi order se juri nahi — aise hi rahegi)'}`)
  for (const l of leads) console.log(`     lead ${l.lead_number}`)
  for (const a of addrs) console.log(`     ek address bhi saath jayega`)
  console.log(`     phir ${dup.customer_number} hata diya jayega`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  await query('BEGIN')
  try {
    await query(`INSERT INTO ${BACKUP} (what, ref, row_data)
                 SELECT 'customer', $2, to_jsonb(x) FROM customers x WHERE x.id=$1`, [dup.id, DUP])
    for (const p of pays) {
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data)
                   SELECT 'payment', $2, to_jsonb(x) FROM payments x WHERE x.id=$1`, [p.id, p.payment_number])
      await query(`UPDATE payments SET customer_id=$2, updated_at=NOW() WHERE id=$1`, [p.id, real.id])
    }
    for (const l of leads) {
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data)
                   SELECT 'lead', $2, to_jsonb(x) FROM leads x WHERE x.id=$1`, [l.id, l.lead_number])
      await query(`UPDATE leads SET customer_id=$2 WHERE id=$1`, [l.id, real.id])
    }
    for (const a of addrs) await query(`UPDATE customer_addresses SET customer_id=$2 WHERE id=$1`, [a.id, real.id])
    await query(`UPDATE customers SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1`, [dup.id])
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const odd = await one(`SELECT COUNT(*) AS n FROM customers
                          WHERE deleted_at IS NULL AND customer_number !~ '^CUST-2026-[0-9]{4}$'`)
  console.log(`\nho gaya. ab ${odd.n} customers aise hain jinka number ghalat shakl ka ho.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
