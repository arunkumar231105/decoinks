/**
 * PAY-2026-0132 ko ORD-2026-0125 par lagana — owner ke batane par.
 *
 * Dono 2 September ke hain aur dono $232.25 ke:
 *   ORD-2026-0125  Robert Farrar  $206.25 + $26.00 shipping = $232.25   unpaid
 *   PAY-2026-0132  paypal, $232.25, loose
 *
 * Payment par payer ka naam nahi aur notes kehte hain "Full payment recorded
 * when invoice was created" — yaani yeh app ne khud banayi thi. Aisi rows par
 * pehle shak kiya gaya tha (PAY-2026-0093 isi wajah se hataya gaya tha, kyunke
 * wo ek asal payment ki naql thi). Yahan soorat mukhtalif hai: is raqam ki koi
 * doosri payment poore system mein nahi, tareekh order se milti hai, aur usi
 * din ki PAY-2026-0131 bhi isi shakl ki hai aur ORD-2026-0124 par theek lagi
 * hui hai. Owner ne tasdeeq bhi ki hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'farrar_sept_payment_backup_20260905'
const PAY = 'PAY-2026-0132'
const ORD = 'ORD-2026-0125'

const money = n => `$${Number(n).toFixed(2)}`
async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')

  const p = await one(`SELECT id, payment_number, payment_date::date AS d, amount, payment_method, order_id
                         FROM payments WHERE payment_number=$1`, [PAY])
  const o = await one(`SELECT o.id, o.order_number, o.order_date::date AS d, o.total, o.customer_id,
                              o.invoice_id, c.name AS customer
                         FROM orders o JOIN customers c ON c.id=o.customer_id
                        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [ORD])
  if (!p) { console.log(`${PAY} nahi mili.`); await pool.end(); return }
  if (!o) { console.log(`${ORD} nahi mila.`); await pool.end(); return }
  if (p.order_id) { console.log(`${PAY} pehle se kisi order par lagi hui hai.`); await pool.end(); return }

  const busy = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
  if (busy) { console.log(`${ORD} par pehle se ${busy.payment_number} lagi hui hai.`); await pool.end(); return }
  if (Math.abs(Number(p.amount) - Number(o.total)) > 0.005) {
    console.log(`Payment ${money(p.amount)} magar order ${money(o.total)} — barabar nahi, kuch nahi kiya.`)
    await pool.end(); return
  }
  // Wahi raqam kahin aur bhi ho to pehle wo dekh lein.
  const twin = await one(`SELECT payment_number FROM payments
                           WHERE ROUND(amount,2)=ROUND($1,2) AND payment_number<>$2`, [p.amount, PAY])
  if (twin) { console.log(`${twin.payment_number} bhi ${money(p.amount)} ki hai — pehle wo dekhein.`); await pool.end(); return }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`  ${PAY}  ${p.d}  ${money(p.amount)}  ${p.payment_method}   →   ${ORD}  ${o.d}  ${o.customer}  ${money(o.total)}`)
  console.log(`  farq: ${money(Number(p.amount) - Number(o.total))}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  const { rows: snap } = await query(`SELECT to_jsonb(x) AS j FROM payments x WHERE x.id=$1`, [p.id])
  await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('payment',$1,$2)`, [PAY, snap[0].j])

  await query(`UPDATE payments SET order_id=$2, customer_id=$3, updated_at=NOW() WHERE id=$1`,
    [p.id, o.id, o.customer_id])
  await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [o.id, o.total])
  if (o.invoice_id) await query(
    `UPDATE invoices SET amount_paid=$2, balance_due=GREATEST(total-$2,0), updated_at=NOW() WHERE id=$1`,
    [o.invoice_id, o.total])

  const left = await one(`SELECT COUNT(*) AS n FROM orders o
                           WHERE o.deleted_at IS NULL AND NOT o.is_free
                             AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id)`)
  console.log(`\nho gaya. ab ${left.n} orders bina payment ke.`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
