/**
 * Paanch payments jo chat gawah hai ke aayin, magar deposit file mein nahi hain.
 *
 * PEHLE YEH PARH LEIN. Ab tak payments table ka poora bharosa is par tha ke
 * usmein bilkul wahi rows hain jo owner ke mailbox deposits (PayPal, Zelle,
 * Stripe) mein hain. Yeh script us usool se hatt kar chat ki gawahi par row
 * banati hai. Chat mein "paid" likha hona aur paisa waqai bank tak pahunchna
 * do alag cheezein hain.
 *
 * Is liye har row ke notes mein CHAT-DARJ likha jata hai, taake yeh ek hi
 * query se alag ki ja sakein aur zaroorat par mitai ja sakein:
 *     SELECT * FROM payments WHERE notes LIKE '%CHAT-DARJ%'
 *
 * Kyun yeh deposit file mein nahi: teenon rastey aise hain jo file mein aate
 * hi nahi — bank transfer, Cash App, aur card. File sirf PayPal/Zelle/Stripe
 * ki notifications se banti hai.
 *
 *   ORD-2026-0096  John Lilly      $35   conv 426. 4 Aug staff ne card ka
 *                                        payment link bheja; 5 Aug staff:
 *                                        "We have received your payment. Your
 *                                        order has been confirmed!"; 13 Aug wo
 *                                        khud: "I paid $35. Dollars and it has
 *                                        been was on Bank of America VISA".
 *   ORD-2026-0098  Richard Dukes   $40   conv 505, 6 Aug: "Total will be $25 +
 *                                        $15 (Shipping)" → "Total will be $40";
 *                                        PayPal; "Payment went tru" → staff:
 *                                        "Your payment has been received, and
 *                                        your order is confirmed."
 *   ORD-2026-0118  Thomas Garcia  $390   conv 563, 17 Aug: "i can get my order
 *                                        for 390 its all i got ... pay 390";
 *                                        staff ne Bank of America ka account
 *                                        diya; usi din: "Its paid bro"; agle
 *                                        din staff: "we have issued the
 *                                        production card yesterday".
 *   ORD-2026-0122  Joseph Giles    $70   conv 648, 13 Aug: "5 T-shirt will cost
 *                                        $11 each plus $15 shipping.. Total
 *                                        cost will $55 + $15 = $70"; 14 Aug:
 *                                        "I just paid it" → staff: "Yes we have
 *                                        received your payment."
 *   ORD-2026-0080  Victor Spates   $88   conv 21, 23 Jul: "Both designs 4 pcs
 *                                        total price will be $73 + Shipping" →
 *                                        "$73 + $15 (shipping)"; 25 Jul: "I
 *                                        made the deposit and made the payment
 *                                        for the $73 dollar order was it
 *                                        received" → staff: "We have received
 *                                        your payment." Wo Cash App istemal
 *                                        karta hai (31 Jul: "Sorry I sent it to
 *                                        cash app").
 *
 * Do orders ka total pehle theek hota hai, aur dono par wahi purani ghalti hai
 * — quote ka total subtotal ke khane mein, phir shipping dobara:
 *     ORD-2026-0098  $55.00 → $40.00   ($25 + $15)
 *     ORD-2026-0080  $103.00 → $88.00  ($73 + $15)
 *
 * Payment number 0101 se shuru hote hain. Counter 119 par khada tha jabke
 * aakhri number PAY-2026-0100 tha, is liye counter pehle 100 par set hota hai.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'chat_witnessed_payments_20260825'
const MARK = 'CHAT-DARJ'
const money = n => `$${Number(n).toFixed(2)}`

const ROWS = [
  { ord: 'ORD-2026-0096', payer: 'John Lilly',     amount: 35.00,  date: '2026-08-05',
    method: 'other',  how: 'card (Stripe payment link)', conv: 426,
    fix: null },
  { ord: 'ORD-2026-0098', payer: 'Richard Dukes',  amount: 40.00,  date: '2026-08-06',
    method: 'PayPal', how: 'PayPal', conv: 505,
    fix: { subtotal: 25.00, shipping: 15.00, total: 40.00 } },
  { ord: 'ORD-2026-0118', payer: 'Thomas Garcia',  amount: 390.00, date: '2026-08-17',
    method: 'other',  how: 'bank transfer (Bank of America)', conv: 563,
    fix: null },
  { ord: 'ORD-2026-0122', payer: 'Joseph Giles',   amount: 70.00,  date: '2026-08-14',
    method: 'other',  how: 'na-maloom — usne cheque cash karaya tha', conv: 648,
    fix: null },
  { ord: 'ORD-2026-0080', payer: 'Victor Spates',  amount: 88.00,  date: '2026-07-24',
    method: 'other',  how: 'Cash App', conv: 21,
    fix: { subtotal: 73.00, shipping: 15.00, total: 88.00 } },
]

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = [], skipped = []

  for (const r of ROWS) {
    const o = await one(
      `SELECT o.id, o.order_number, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
              o.customer_id, o.invoice_id, c.name AS customer
         FROM orders o JOIN customers c ON c.id=o.customer_id
        WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [r.ord])
    if (!o) { skipped.push([r.ord, 'order nahi mila']); continue }

    const taken = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
    if (taken) { skipped.push([r.ord, `pehle se ${taken.payment_number} lagi hui hai`]); continue }

    const target = r.fix || { subtotal: Number(o.subtotal), shipping: Number(o.shipping), total: Number(o.total) }
    if (Math.abs(target.subtotal + target.shipping - target.total) > 0.005) {
      skipped.push([r.ord, `${money(target.subtotal)} + ${money(target.shipping)} ≠ ${money(target.total)}`]); continue
    }
    if (Math.abs(target.total - r.amount) > 0.005) {
      skipped.push([r.ord, `order ${money(target.total)} magar payment ${money(r.amount)} — barabar nahi`]); continue
    }
    // Wahi raqam wahi din deposit file mein pehle se ho to dobara na banayein.
    const dup = await one(
      `SELECT payment_number FROM payments
        WHERE ROUND(amount,2)=ROUND($1,2) AND payment_date::date=$2::date`, [r.amount, r.date])
    if (dup) { skipped.push([r.ord, `${dup.payment_number} usi din usi raqam ki pehle se hai — dekh lein`]); continue }

    plan.push({ ...r, o, target })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  for (const p of plan) {
    console.log(`${p.ord}  ${p.o.customer}`)
    if (p.fix) console.log(`   order: ${money(p.o.total)} → ${money(p.target.total)}  (sub ${money(p.target.subtotal)} + ship ${money(p.target.shipping)})`)
    else       console.log(`   order: ${money(p.o.total)}  (waise hi rehta hai)`)
    console.log(`   nayi payment: ${money(p.amount)}  ${p.date}  ${p.how}   [conv ${p.conv}]`)
  }
  if (skipped.length) {
    console.log('\nCHHORE GAYE:')
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }
  const total = plan.reduce((s, p) => s + p.amount, 0)
  console.log(`\nbanenge: ${plan.length} payments, kul ${money(total)}`)
  const before = await one(`SELECT COUNT(*) AS n FROM payments`)
  console.log(`payments ${before.n} → ${Number(before.n) + plan.length}`)
  console.log(`\nMitane ke liye:  DELETE FROM payments WHERE notes LIKE '%${MARK}%';\n`)

  if (!apply) { console.log('Likhne ke liye --apply lagayein.\n'); await pool.end(); return }
  if (!plan.length) { console.log('Karne ko kuch nahi.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    what text, ref text, row_data jsonb, saved_at timestamptz NOT NULL DEFAULT NOW())`)

  // Counter aakhri asal number par le aana, warna numbers mein khali jagah rehti hai.
  const maxNo = await one(
    `SELECT COALESCE(MAX(SUBSTRING(payment_number FROM 10)::int), 0) AS n
       FROM payments WHERE payment_number LIKE 'PAY-2026-%'`)
  await query(`UPDATE counters SET last_value=$1, updated_at=NOW() WHERE scope='PAY-2026'`, [maxNo.n])

  for (const p of plan) {
    if (p.fix) {
      const { rows: snap } = await query(`SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [p.o.id])
      await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('order',$1,$2)`, [p.ord, snap[0].j])
      await query(
        `UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
          WHERE id=$1`, [p.o.id, p.target.subtotal, p.target.shipping, p.target.total])
      if (p.o.invoice_id) await query(
        `UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
                balance_due=0, status='Paid', updated_at=NOW() WHERE id=$1`,
        [p.o.invoice_id, p.target.subtotal, p.target.shipping, p.target.total])
    } else {
      await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [p.o.id, p.target.total])
      if (p.o.invoice_id) await query(
        `UPDATE invoices SET amount_paid=$2, balance_due=GREATEST(total-$2,0), updated_at=NOW()
          WHERE id=$1`, [p.o.invoice_id, p.target.total])
    }

    const c = await one(`UPDATE counters SET last_value=last_value+1, updated_at=NOW()
                          WHERE scope='PAY-2026' RETURNING last_value`)
    const payNo = `PAY-2026-${String(c.last_value).padStart(4, '0')}`

    const note = `${MARK} — Chatwoot conv ${p.conv} se darj. ${p.how}. ` +
                 `Owner ke mailbox deposit file mein NAHI hai, kyunke yeh rasta us file mein aata hi nahi.`
    const ins = await one(
      `INSERT INTO payments (payment_number, payment_date, amount, payment_method, notes,
                             order_id, customer_id, customer_name, received_from_name, status,
                             created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'completed',NOW(),NOW()) RETURNING id`,
      [payNo, p.date, p.amount, p.method, note, p.o.id, p.o.customer_id, p.payer])

    await query(`INSERT INTO ${BACKUP} (what, ref, row_data) VALUES ('payment',$1,$2)`,
      [payNo, JSON.stringify({ id: ins.id, order: p.ord, amount: p.amount, payer: p.payer })])
    console.log(`  ${payNo}  ${money(p.amount)}  ${p.payer}  → ${p.ord}`)
  }

  const after = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  console.log(`\nho gaya. ab ${after.n} payments, ${after.loose} bina order ke.`)
  console.log(`Mitane ke liye:  DELETE FROM payments WHERE notes LIKE '%${MARK}%';\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
