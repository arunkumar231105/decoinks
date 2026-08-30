/**
 * Work backwards from the sales orders: every one of the 117 should have the
 * quotation it grew from and the invoice it was billed on, and all three should
 * agree about the money.
 *
 * Four passes, in this order, because each depends on the last:
 *   1. REUSE   — a loose quote or invoice that matches an order on customer,
 *                amount and date is that order's. Creating a second would be
 *                the same document twice.
 *   2. RETIRE  — documents whose order was moved out to Claims follow it. Free
 *                work is not billed, so its invoice is not part of the book.
 *   3. CORRECT — where a linked document disagrees with its order, the order is
 *                the truth: it carries the lines and the money that was taken.
 *   4. CREATE  — whatever is still missing, built from the order itself.
 *
 * Reuse before create, always: a document raised by hand months ago is the real
 * one, and replacing it would lose whatever else it carries.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

const money = n => `$${Number(n || 0).toFixed(2)}`
const initials = name => (String(name || 'CUS').replace(/[^A-Za-z]/g, '') || 'CUS')
  .slice(0, 3).toUpperCase()

async function nextQuoteNumber() {
  const { rows } = await query(
    `SELECT 'Q-2026-' || lpad((COALESCE(MAX(NULLIF(split_part(quote_number,'-',3),'')::INT),0)+1)::text,4,'0') AS n
       FROM quotations WHERE quote_number LIKE 'Q-2026-%'`)
  return rows[0].n
}
// Invoices are numbered by the customer's initials, so the series is per-name.
async function nextInvoiceNumber(customerName) {
  const p = initials(customerName)
  const { rows } = await query(
    `SELECT $1 || '-' || lpad((COALESCE(MAX(NULLIF(split_part(invoice_number,'-',2),'')::INT),0)+1)::text,4,'0') AS n
       FROM invoices WHERE invoice_number LIKE $1 || '-%'`, [p])
  return rows[0].n
}

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = { reuse: [], retire: [], correct: [], create: [] }

  const orders = (await query(
    `SELECT o.id, o.order_number, o.order_date, o.customer_id, o.order_type,
            o.invoice_id, o.quotation_id,
            COALESCE(o.subtotal,0) AS subtotal, COALESCE(o.shipping_charges,0) AS shipping,
            COALESCE(o.total,0) AS total, o.payment_terms, o.payment_method, o.status::text AS status,
            COALESCE(NULLIF(c.company_name,''), c.name) AS customer
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.deleted_at IS NULL ORDER BY o.order_date, o.order_number`)).rows

  // Loose documents: alive, but no live order claims them.
  const looseInv = (await query(
    `SELECT i.id, i.invoice_number, i.issue_date, i.customer_id, COALESCE(i.total,0) AS total,
            EXISTS (SELECT 1 FROM orders o WHERE o.invoice_id = i.id) AS had_order
       FROM invoices i
      WHERE i.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.invoice_id = i.id AND o.deleted_at IS NULL)`)).rows
  const looseQuo = (await query(
    `SELECT q.id, q.quote_number, q.created_at::date AS made_on, q.customer_id, COALESCE(q.total,0) AS total,
            EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id) AS had_order
       FROM quotations q
      WHERE q.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id AND o.deleted_at IS NULL)`)).rows

  const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000)
  const takenI = new Set(), takenQ = new Set()

  for (const o of orders) {
    // ── 1. reuse ──
    if (!o.invoice_id) {
      const hit = looseInv.find(i => !takenI.has(i.id) && i.customer_id === o.customer_id
        && Math.abs(Number(i.total) - Number(o.total)) < 0.005 && days(i.issue_date, o.order_date) <= 10)
      if (hit) { takenI.add(hit.id); plan.reuse.push({ kind: 'invoice', o, doc: hit }) }
    }
    if (!o.quotation_id) {
      const hit = looseQuo.find(q => !takenQ.has(q.id) && q.customer_id === o.customer_id
        && Math.abs(Number(q.total) - Number(o.total)) < 0.005 && days(q.made_on, o.order_date) <= 10)
      if (hit) { takenQ.add(hit.id); plan.reuse.push({ kind: 'quote', o, doc: hit }) }
    }
  }

  // ── 2. retire — the order they belonged to left the book ──
  for (const i of looseInv) if (!takenI.has(i.id) && i.had_order) plan.retire.push({ kind: 'invoice', doc: i })
  for (const q of looseQuo) if (!takenQ.has(q.id) && q.had_order) plan.retire.push({ kind: 'quote', doc: q })
  const stranded = [...looseInv.filter(i => !takenI.has(i.id) && !i.had_order).map(d => ({ kind: 'invoice', doc: d })),
                    ...looseQuo.filter(q => !takenQ.has(q.id) && !q.had_order).map(d => ({ kind: 'quote', doc: d }))]

  // ── 3. correct, and 4. create ──
  const reusedI = new Map(plan.reuse.filter(r => r.kind === 'invoice').map(r => [r.o.id, r.doc]))
  const reusedQ = new Map(plan.reuse.filter(r => r.kind === 'quote').map(r => [r.o.id, r.doc]))
  const wrong = (await query(
    `SELECT o.id, o.order_number, o.total,
            i.id AS inv_id, i.invoice_number, COALESCE(i.total,0) AS inv_total,
            q.id AS quo_id, q.quote_number,   COALESCE(q.total,0) AS quo_total
       FROM orders o
       LEFT JOIN invoices   i ON i.id = o.invoice_id   AND i.deleted_at IS NULL
       LEFT JOIN quotations q ON q.id = o.quotation_id AND q.deleted_at IS NULL
      WHERE o.deleted_at IS NULL`)).rows
  for (const w of wrong) {
    if (w.inv_id && Math.abs(Number(w.inv_total) - Number(w.total)) >= 0.005)
      plan.correct.push({ kind: 'invoice', ...w })
    if (w.quo_id && Math.abs(Number(w.quo_total) - Number(w.total)) >= 0.005)
      plan.correct.push({ kind: 'quote', ...w })
  }
  for (const o of orders) {
    if (!o.invoice_id   && !reusedI.has(o.id)) plan.create.push({ kind: 'invoice', o })
    if (!o.quotation_id && !reusedQ.has(o.id)) plan.create.push({ kind: 'quote', o })
  }

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  console.log(`orders: ${orders.length}`)
  console.log(`  1. JORE JAYENGE (pehle se bane hain)   ${plan.reuse.length}`)
  console.log(`  2. RETIRE (order claims mein chala gaya) ${plan.retire.length}`)
  console.log(`  3. THEEK HONGE (total order se nahi milta) ${plan.correct.length}`)
  console.log(`  4. NAYE BANENGE                          ${plan.create.length}`)
  console.log(`  — kisi order ka nahi, chhora ja raha hai  ${stranded.length}`)
  if (plan.reuse.length) {
    console.log('\nJORE JAYENGE:')
    for (const r of plan.reuse.slice(0, 12))
      console.log(`  ${r.o.order_number}  ${money(r.o.total).padStart(10)}  <-  ${r.kind} ${r.doc.invoice_number ?? r.doc.quote_number}`)
    if (plan.reuse.length > 12) console.log(`  … aur ${plan.reuse.length - 12}`)
  }
  if (stranded.length) {
    console.log('\nKISI ORDER KA NAHI (haath nahi lagaya, aap dekhein):')
    for (const s of stranded)
      console.log(`  ${s.kind.padEnd(8)} ${s.doc.invoice_number ?? s.doc.quote_number}  ${money(s.doc.total)}`)
  }

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const r of plan.reuse) {
      const col = r.kind === 'invoice' ? 'invoice_id' : 'quotation_id'
      await query(`UPDATE orders SET ${col} = $2, updated_at = NOW() WHERE id = $1`, [r.o.id, r.doc.id])
      if (r.kind === 'invoice')
        await query(`UPDATE invoices SET order_id = $2, updated_at = NOW() WHERE id = $1`, [r.doc.id, r.o.id])
    }
    for (const t of plan.retire) {
      const table = t.kind === 'invoice' ? 'invoices' : 'quotations'
      await query(`UPDATE ${table} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [t.doc.id])
    }
    for (const c of plan.correct) {
      if (c.kind === 'invoice') {
        // balance_due follows: what is owed is the total less what was paid.
        await query(
          `UPDATE invoices i SET total = $2,
                  subtotal = o.subtotal, shipping_charges = o.shipping_charges,
                  balance_due = GREATEST($2 - COALESCE(i.amount_paid,0), 0), updated_at = NOW()
             FROM orders o WHERE o.id = $3 AND i.id = $1`, [c.inv_id, c.total, c.id])
      } else {
        await query(
          `UPDATE quotations q SET total = $2, subtotal = o.subtotal,
                  estimated_shipping = o.shipping_charges, updated_at = NOW()
             FROM orders o WHERE o.id = $3 AND q.id = $1`, [c.quo_id, c.total, c.id])
      }
    }
    for (const n of plan.create) {
      const o = n.o
      if (n.kind === 'invoice') {
        const number = await nextInvoiceNumber(o.customer)
        const { rows } = await query(
          `INSERT INTO invoices (invoice_number, customer_id, order_id, issue_date, due_date,
                                 subtotal, shipping_charges, total, amount_paid, balance_due,
                                 status, payment_terms, payment_method, notes, created_at, updated_at)
           SELECT $1,$2,$3,$4::date,$4::date,$5,$6,$7, p.paid, GREATEST($7 - p.paid, 0),
                  (CASE WHEN p.paid <= 0 THEN 'Sent'
                        WHEN p.paid >= $7 THEN 'Paid'
                        ELSE 'Partially Paid' END)::invoice_status,
                  $8,$9, 'Raised from ' || $10, NOW(), NOW()
             FROM (SELECT COALESCE(SUM(amount),0) AS paid FROM payments
                    WHERE order_id = $3) p
           RETURNING id`,
          [number, o.customer_id, o.id, o.order_date, o.subtotal, o.shipping, o.total,
           o.payment_terms, o.payment_method, o.order_number])
        await query(`UPDATE orders SET invoice_id = $2, updated_at = NOW() WHERE id = $1`, [o.id, rows[0].id])
      } else {
        const number = await nextQuoteNumber()
        const { rows } = await query(
          `INSERT INTO quotations (quote_number, customer_id, order_type, entry_date,
                                   subtotal, estimated_shipping, total, status, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4::date,$5,$6,$7,'Approved','Raised from ' || $8, $4::date, NOW())
           RETURNING id`,
          [number, o.customer_id, o.order_type, o.order_date, o.subtotal, o.shipping, o.total, o.order_number])
        await query(`UPDATE orders SET quotation_id = $2, updated_at = NOW() WHERE id = $1`, [o.id, rows[0].id])
      }
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }

  const after = (await query(
    `SELECT (SELECT count(*)::INT FROM orders WHERE deleted_at IS NULL) AS orders,
            (SELECT count(*)::INT FROM invoices WHERE deleted_at IS NULL) AS invoices,
            (SELECT count(*)::INT FROM quotations WHERE deleted_at IS NULL) AS quotations`)).rows[0]
  console.log(`\nab: ${after.orders} orders, ${after.invoices} invoices, ${after.quotations} quotations\n`)
  await pool.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
