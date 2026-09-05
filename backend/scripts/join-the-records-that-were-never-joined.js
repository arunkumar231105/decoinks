/**
 * Jo rishtay banne chahiye the magar bane nahi.
 *
 * Har record kis ka hai — yeh chaar jagah adhoora reh gaya tha. Har jagah ka
 * jawab pehle se system ke andar mojood hai, kahin bahar se andaza nahi lagana
 * parta:
 *
 *   payments.customer_id       6 rows khali — magar unka order laga hua hai,
 *                              aur order par customer likha hai.
 *   purchase_orders.customer_id 9 rows khali — wahi baat, PO apne order ke
 *                              zariye customer tak pahunch jata hai.
 *   orders.lead_id             39 orders — un ke customer ka theek ek hi lead
 *                              hai, is liye koi shak nahi ke kaun sa.
 *   quotations.lead_id         41 quotations — isi tarah.
 *
 * JAHAN DO SE ZYADA LEAD HOTE WAHAN CHHOR DIYA JATA. Aisa filhal ek bhi nahi —
 * jin customers ka lead hai un sab ka ek hi hai. Yeh shart phir bhi likhi hui
 * hai kyunke kal ko doosra lead aa sakta hai aur tab andaza lagana ghalat hoga.
 *
 * BAQI 86 ORDERS KA LEAD NAHI BANEGA. Unke customers kisi Facebook lead se nahi
 * aaye, wo TEXSTONE ki purani sheets se darj hue the. Jhoota lead jorne se
 * behtar hai khana khali rehna.
 *
 * DO PAYMENTS PHIR BHI KHALI RAHENGI: PAY-2026-0122 ($75, 1 Sep) aur
 * PAY-2026-0123 ($90, 1 Sep). Na unka order hai na customer, aur naam bhi darj
 * nahi — kis ki hain yeh sirf owner bata sakta hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'joins_backup_20260905'
async function one(sql, p) { const { rows } = await query(sql, p); return rows[0] || null }

// Har qadam: kya ginna hai, aur kya likhna hai. Dono ek hi shart par chalte
// hain, taake jo dry run mein dikhe wahi likha jaye.
const STEPS = [
  { what: 'payments.customer_id  (order se)',
    count: `SELECT COUNT(*) AS n FROM payments p JOIN orders o ON o.id=p.order_id
             WHERE p.customer_id IS NULL AND o.customer_id IS NOT NULL`,
    save:  `INSERT INTO ${BACKUP} (what, ref, row_data)
            SELECT 'payment', p.payment_number, jsonb_build_object('id', p.id, 'customer_id', p.customer_id)
              FROM payments p JOIN orders o ON o.id=p.order_id
             WHERE p.customer_id IS NULL AND o.customer_id IS NOT NULL`,
    write: `UPDATE payments p SET customer_id=o.customer_id, updated_at=NOW()
              FROM orders o WHERE o.id=p.order_id
               AND p.customer_id IS NULL AND o.customer_id IS NOT NULL` },

  { what: 'purchase_orders.customer_id  (order se)',
    count: `SELECT COUNT(*) AS n FROM purchase_orders po JOIN orders o ON o.id=po.order_id
             WHERE po.deleted_at IS NULL AND po.customer_id IS NULL AND o.customer_id IS NOT NULL`,
    save:  `INSERT INTO ${BACKUP} (what, ref, row_data)
            SELECT 'purchase_order', po.po_number, jsonb_build_object('id', po.id, 'customer_id', po.customer_id)
              FROM purchase_orders po JOIN orders o ON o.id=po.order_id
             WHERE po.deleted_at IS NULL AND po.customer_id IS NULL AND o.customer_id IS NOT NULL`,
    write: `UPDATE purchase_orders po SET customer_id=o.customer_id, updated_at=NOW()
              FROM orders o WHERE o.id=po.order_id
               AND po.deleted_at IS NULL AND po.customer_id IS NULL AND o.customer_id IS NOT NULL` },

  { what: 'orders.lead_id  (customer ke iklaute lead se)',
    count: `SELECT COUNT(*) AS n FROM orders o JOIN (
              SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
            ) s ON s.customer_id=o.customer_id WHERE o.deleted_at IS NULL AND o.lead_id IS NULL`,
    save:  `INSERT INTO ${BACKUP} (what, ref, row_data)
            SELECT 'order', o.order_number, jsonb_build_object('id', o.id, 'lead_id', o.lead_id)
              FROM orders o JOIN (
                SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
              ) s ON s.customer_id=o.customer_id WHERE o.deleted_at IS NULL AND o.lead_id IS NULL`,
    write: `UPDATE orders o SET lead_id=l.id, updated_at=NOW()
              FROM leads l JOIN (
                SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
              ) s ON s.customer_id=l.customer_id
             WHERE l.customer_id=o.customer_id AND o.deleted_at IS NULL AND o.lead_id IS NULL` },

  { what: 'quotations.lead_id  (customer ke iklaute lead se)',
    count: `SELECT COUNT(*) AS n FROM quotations q JOIN (
              SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
            ) s ON s.customer_id=q.customer_id WHERE q.deleted_at IS NULL AND q.lead_id IS NULL`,
    save:  `INSERT INTO ${BACKUP} (what, ref, row_data)
            SELECT 'quotation', q.quote_number, jsonb_build_object('id', q.id, 'lead_id', q.lead_id)
              FROM quotations q JOIN (
                SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
              ) s ON s.customer_id=q.customer_id WHERE q.deleted_at IS NULL AND q.lead_id IS NULL`,
    write: `UPDATE quotations q SET lead_id=l.id, updated_at=NOW()
              FROM leads l JOIN (
                SELECT customer_id, count(*) n FROM leads WHERE customer_id IS NOT NULL GROUP BY 1 HAVING count(*)=1
              ) s ON s.customer_id=l.customer_id
             WHERE l.customer_id=q.customer_id AND q.deleted_at IS NULL AND q.lead_id IS NULL` },
]

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  const counts = []
  for (const s of STEPS) counts.push(Number((await one(s.count)).n))
  STEPS.forEach((s, i) => console.log(`  ${String(counts[i]).padStart(3)}  ${s.what}`))

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (what text, ref text, row_data jsonb,
                 saved_at timestamptz NOT NULL DEFAULT NOW())`)
  await query('BEGIN')
  try {
    for (let i = 0; i < STEPS.length; i++) {
      if (!counts[i]) { console.log(`  0    ${STEPS[i].what} — kuch karna nahi`); continue }
      await query(STEPS[i].save)
      const r = await query(STEPS[i].write)
      console.log(`  ${String(r.rowCount).padStart(3)}  ${STEPS[i].what}`)
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const left = await one(`
    SELECT (SELECT COUNT(*) FROM payments WHERE customer_id IS NULL) AS pay,
           (SELECT COUNT(*) FROM purchase_orders WHERE deleted_at IS NULL AND customer_id IS NULL) AS po,
           (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND lead_id IS NULL) AS ord,
           (SELECT COUNT(*) FROM quotations WHERE deleted_at IS NULL AND lead_id IS NULL) AS quo`)
  console.log(`\nab khali: payments.customer_id ${left.pay}, purchase_orders.customer_id ${left.po}, ` +
              `orders.lead_id ${left.ord}, quotations.lead_id ${left.quo}`)
  console.log(`purani halat ${BACKUP} mein hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
