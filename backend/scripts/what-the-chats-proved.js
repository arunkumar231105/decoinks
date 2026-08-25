/**
 * Loose payments settled from the Chatwoot history, not from matching amounts.
 *
 * Matching on amount alone produces 51 candidate pairs for 31 payments — $65,
 * $73 and $45 repeat across unrelated customers, so an exact figure proves
 * nothing. Every action below is instead backed by the conversation in which
 * the price was quoted and the customer said they had paid.
 *
 * LINKS — the order exists and the chat names the price:
 *   PAY-2026-0071  Yang Li $73        conv 461, 6 Aug: "$60 + $13 for shipping
 *                                     = $73", Zelle. ORD-2026-0097 already
 *                                     reads $60 + $13. Link only.
 *   PAY-2026-0065  Stripe $50         conv 21, 31 Jul: "Total $50".
 *                                     ORD-2026-0088 says $65.
 *   PAY-2026-0079  Tabernacle $65     conv 646, 11 Aug: "your total will be
 *                                     $50 + $15 (Shipping)". ORD-2026-0107
 *                                     carries $65 as the subtotal and adds
 *                                     shipping again, reaching $80.
 *   PAY-2026-0074  Angie Tate $38     conv 263, 7 Aug: "Total price will be
 *                                     $38". ORD-2026-0105 says $65.
 *
 * MERGES — one purchase paid in two transfers. The house rule is one payment
 * per sales order, so the second is folded into the first, as PAY-2026-0004
 * and 0005 were:
 *   PAY-2026-0009  $1     into PAY-2026-0006  ORD-2026-0009 was short $1.00
 *   PAY-2026-0060  $5     into PAY-2026-0061  conv 229: "Can I zelle you $5
 *                                             first so I know I'm sending it to
 *                                             the right place" — ORD-2026-0081
 *                                             was short exactly $5.00
 *   PAY-2026-0088  $45    into PAY-2026-0086  conv 23, 18 Aug: "The payment
 *                                             received was $415.25, while the
 *                                             total amount due is $460.23" →
 *                                             "I will send now". ORD-2026-0115
 *                                             is re-totalled to $460.25.
 *
 * DELETE — PAY-2026-0093 $56 is not money that arrived. It is the last of the
 * software-generated rows: the only payment in the table with no payer name,
 * and the only one still carrying orders.service.js's note "Payment recorded
 * from sales order". Timothy Britt's real $56 is PAY-2026-0087, verified from
 * the mailbox and already on ORD-2026-0121, and conv 832 shows him quoted $56
 * once and paying once.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const BACKUP = 'chat_reconciliation_backup_20260825'
const money = n => `$${Number(n).toFixed(2)}`

// payment, order, and what the chat proves the order's money really was.
// A null money block means the order is already right and only needs linking.
const LINKS = [
  { pay: 'PAY-2026-0071', ord: 'ORD-2026-0097', why: 'conv 461: $60 + $13 shipping = $73', set: null },
  { pay: 'PAY-2026-0065', ord: 'ORD-2026-0088', why: 'conv 21: "Total $50"',
    set: { subtotal: 50.00, shipping: 0.00, total: 50.00 } },
  { pay: 'PAY-2026-0079', ord: 'ORD-2026-0107', why: 'conv 646: "$50 + $15 (Shipping)"',
    set: { subtotal: 50.00, shipping: 15.00, total: 65.00 } },
  { pay: 'PAY-2026-0074', ord: 'ORD-2026-0105', why: 'conv 263: "Total price will be $38"',
    set: { subtotal: 38.00, shipping: 0.00, total: 38.00 } },
]

const MERGES = [
  { into: 'PAY-2026-0006', from: 'PAY-2026-0009', ord: 'ORD-2026-0009', why: 'order $1.00 short', set: null },
  { into: 'PAY-2026-0061', from: 'PAY-2026-0060', ord: 'ORD-2026-0081', why: 'conv 229: $5 verification transfer first', set: null },
  { into: 'PAY-2026-0086', from: 'PAY-2026-0088', ord: 'ORD-2026-0115', why: 'conv 23: $415.25 paid of $460.25 due, balance sent',
    set: { subtotal: 415.25, shipping: 45.00, total: 460.25 } },
]

const DELETES = [
  { pay: 'PAY-2026-0093', why: 'software-generated duplicate of Timothy Britt\'s PAY-2026-0087; no payer name' },
]

async function one(sql, params) { const { rows } = await query(sql, params); return rows[0] || null }

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = { links: [], merges: [], deletes: [] }
  const skipped = []

  for (const l of LINKS) {
    const p = await one(`SELECT id, amount, order_id FROM payments WHERE payment_number=$1`, [l.pay])
    const o = await one(`SELECT o.id, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
                                o.invoice_id, c.name AS customer
                           FROM orders o JOIN customers c ON c.id=o.customer_id
                          WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [l.ord])
    if (!p) { skipped.push([l.pay, 'payment nahi mili']); continue }
    if (!o) { skipped.push([l.ord, 'order nahi mila']); continue }
    if (p.order_id) { skipped.push([l.pay, 'pehle se kisi order par lagi hui hai']); continue }
    const taken = await one(`SELECT payment_number FROM payments WHERE order_id=$1`, [o.id])
    if (taken) { skipped.push([l.ord, `par pehle se ${taken.payment_number} lagi hui hai`]); continue }

    const target = l.set || { subtotal: Number(o.subtotal), shipping: Number(o.shipping), total: Number(o.total) }
    if (Math.abs(target.total - Number(p.amount)) > 0.005) {
      skipped.push([l.pay, `chat ka total ${money(target.total)} magar payment ${money(p.amount)} — barabar nahi`]); continue
    }
    plan.links.push({ ...l, p, o, target })
  }

  for (const m of MERGES) {
    const into = await one(`SELECT id, amount, order_id, payment_number FROM payments WHERE payment_number=$1`, [m.into])
    const from = await one(`SELECT id, amount, payment_number FROM payments WHERE payment_number=$1`, [m.from])
    const o = await one(`SELECT o.id, o.subtotal, COALESCE(o.shipping_charges,0) AS shipping, o.total,
                                o.invoice_id, c.name AS customer
                           FROM orders o JOIN customers c ON c.id=o.customer_id
                          WHERE o.order_number=$1 AND o.deleted_at IS NULL`, [m.ord])
    if (!into || !from || !o) { skipped.push([m.from, 'payment ya order nahi mila']); continue }
    if (String(into.order_id) !== String(o.id)) { skipped.push([m.into, `${m.ord} par nahi lagi hui`]); continue }

    const combined = +(Number(into.amount) + Number(from.amount)).toFixed(2)
    const target = m.set || { subtotal: Number(o.subtotal), shipping: Number(o.shipping), total: Number(o.total) }
    if (Math.abs(target.total - combined) > 0.005) {
      skipped.push([m.from, `dono milakar ${money(combined)} magar order ${money(target.total)} — barabar nahi`]); continue
    }
    plan.merges.push({ ...m, into, from, o, combined, target })
  }

  for (const d of DELETES) {
    const p = await one(`SELECT id, amount, order_id, received_from_name, notes FROM payments WHERE payment_number=$1`, [d.pay])
    if (!p) { skipped.push([d.pay, 'payment nahi mili']); continue }
    if (p.order_id) { skipped.push([d.pay, 'kisi order par lagi hui hai — haath nahi lagaya']); continue }
    if (p.received_from_name) { skipped.push([d.pay, `payer ka naam mojood hai (${p.received_from_name}) — asli lag rahi hai`]); continue }
    plan.deletes.push({ ...d, p })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)

  console.log('LINK — order mojood hai, chat ne qeemat batai:')
  for (const l of plan.links) {
    const changed = l.set
      ? `  order: ${money(l.o.total)} → ${money(l.target.total)} (sub ${money(l.target.subtotal)} + ship ${money(l.target.shipping)})`
      : `  order pehle se durust: ${money(l.o.total)}`
    console.log(`  ${l.pay} ${money(l.p.amount).padStart(9)} → ${l.ord}  ${l.o.customer}`)
    console.log(`   ${l.why}`)
    console.log(`   ${changed.trim()}`)
  }

  console.log('\nMERGE — ek kharidari, do transfer:')
  for (const m of plan.merges) {
    console.log(`  ${m.from.payment_number} ${money(m.from.amount).padStart(9)} → ${m.into.payment_number} (${money(m.into.amount)} → ${money(m.combined)})  ${m.o.customer} / ${m.ord}`)
    console.log(`   ${m.why}`)
    if (m.set) console.log(`   order: ${money(m.o.total)} → ${money(m.target.total)} (sub ${money(m.target.subtotal)} + ship ${money(m.target.shipping)})`)
  }

  console.log('\nDELETE — jo paisa aaya hi nahi:')
  for (const d of plan.deletes) console.log(`  ${d.pay} ${money(d.p.amount)}  ${d.why}`)

  if (skipped.length) {
    console.log(`\nCHHORE GAYE:`)
    for (const [n, why] of skipped) console.log(`  ${n}  ${why}`)
  }

  const before = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  const removing = plan.merges.length + plan.deletes.length
  console.log(`\nabhi: ${before.total} payments, ${before.loose} bina order ke`)
  console.log(`baad mein: ${before.total - removing} payments, ${before.loose - plan.links.length - removing} bina order ke`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query(`CREATE TABLE IF NOT EXISTS ${BACKUP} (
    action text, payment_number text, payment_row jsonb, order_number text, order_row jsonb,
    saved_at timestamptz NOT NULL DEFAULT NOW())`)

  const snapPay = id => one(`SELECT to_jsonb(p) AS j FROM payments p WHERE p.id=$1`, [id])
  const snapOrd = id => one(`SELECT to_jsonb(o) AS j FROM orders o WHERE o.id=$1`, [id])

  // The invoice has to follow the order, or it goes on showing a balance that
  // the payment already settled.
  async function retotalInvoice(invoiceId, total) {
    if (!invoiceId) return
    await query(`UPDATE invoices SET shipping_charges = $2, total = $3, amount_paid = $3,
                        balance_due = 0, updated_at = NOW() WHERE id = $1`,
      [invoiceId, 0, total])
  }

  for (const l of plan.links) {
    await query(`INSERT INTO ${BACKUP} (action, payment_number, payment_row, order_number, order_row)
                 VALUES ('link',$1,$2,$3,$4)`,
      [l.pay, (await snapPay(l.p.id)).j, l.ord, (await snapOrd(l.o.id)).j])
    if (l.set) {
      await query(`UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
                    WHERE id=$1`, [l.o.id, l.target.subtotal, l.target.shipping, l.target.total])
      await query(`UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
                          balance_due=0, updated_at=NOW() WHERE id=$1`,
        [l.o.invoice_id, l.target.subtotal, l.target.shipping, l.target.total])
    } else {
      await retotalInvoice(l.o.invoice_id, l.target.total)
      await query(`UPDATE invoices SET shipping_charges=$2, total=$3, amount_paid=$3, balance_due=0, updated_at=NOW()
                    WHERE id=$1`, [l.o.invoice_id, l.target.shipping, l.target.total])
      await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [l.o.id, l.target.total])
    }
    await query(`UPDATE payments SET order_id=$2, updated_at=NOW() WHERE id=$1`, [l.p.id, l.o.id])
  }

  for (const m of plan.merges) {
    await query(`INSERT INTO ${BACKUP} (action, payment_number, payment_row, order_number, order_row)
                 VALUES ('merge-removed',$1,$2,$3,$4)`,
      [m.from.payment_number, (await snapPay(m.from.id)).j, m.ord, (await snapOrd(m.o.id)).j])
    await query(`INSERT INTO ${BACKUP} (action, payment_number, payment_row, order_number, order_row)
                 VALUES ('merge-kept',$1,$2,$3,NULL)`,
      [m.into.payment_number, (await snapPay(m.into.id)).j, m.ord])

    await query(`UPDATE payments SET amount=$2,
                        notes = COALESCE(NULLIF(notes,''),'') ||
                          CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END ||
                          $3, updated_at=NOW()
                  WHERE id=$1`,
      [m.into.id, m.combined,
       `${m.from.payment_number} (${money(m.from.amount)}) isi kharidari ka doosra hissa tha, isme mila diya`])
    await query(`DELETE FROM payments WHERE id=$1`, [m.from.id])

    if (m.set) {
      await query(`UPDATE orders SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4, updated_at=NOW()
                    WHERE id=$1`, [m.o.id, m.target.subtotal, m.target.shipping, m.target.total])
      await query(`UPDATE invoices SET subtotal=$2, shipping_charges=$3, total=$4, amount_paid=$4,
                          balance_due=0, updated_at=NOW() WHERE id=$1`,
        [m.o.invoice_id, m.target.subtotal, m.target.shipping, m.target.total])
    } else {
      await query(`UPDATE orders SET amount_paid=$2, updated_at=NOW() WHERE id=$1`, [m.o.id, m.combined])
      await query(`UPDATE invoices SET amount_paid=$2, balance_due=GREATEST(total-$2,0), updated_at=NOW()
                    WHERE id=$1`, [m.o.invoice_id, m.combined])
    }
  }

  for (const d of plan.deletes) {
    await query(`INSERT INTO ${BACKUP} (action, payment_number, payment_row, order_number, order_row)
                 VALUES ('delete',$1,$2,NULL,NULL)`, [d.pay, (await snapPay(d.p.id)).j])
    await query(`DELETE FROM payments WHERE id=$1`, [d.p.id])
  }

  const after = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE order_id IS NULL) AS loose FROM payments`)
  console.log(`\nho gaya. ab ${after.total} payments, ${after.loose} bina order ke.`)
  console.log(`purani halat ${BACKUP} mein mehfooz hai.\n`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
