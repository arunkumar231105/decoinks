/**
 * The lists read a document's own snapshot of the buyer, not the join to
 * customers — quotations and invoices each carry their own customer_name. The
 * documents raised by every-order-gets-its-quote-and-invoice.js set customer_id
 * and nothing else, so they showed a blank name, no quantity and no money while
 * the row underneath was complete.
 *
 * Four repairs, all additive — no header total is touched, because those were
 * already reconciled against the orders:
 *   1. NAME     — copy the buyer's name onto the document that is missing it.
 *   2. BUYER    — a document naming a customer that exists, but not linked to
 *                 them, gets the link.
 *   3. QUOTE    — an invoice reaches its quotation through the order that
 *                 carries both, so invoices.quote_id is filled from there.
 *   4. LINES    — a document whose order has line items but which has none of
 *                 its own reads as $0.00 work. The order's lines are copied in.
 *
 * Dry run by default. Pass --apply to write.
 */
const { query, pool } = require('../src/config/db')

async function main() {
  const apply = process.argv.includes('--apply')
  const say = (label, n) => console.log(`  ${label.padEnd(34)} ${n}`)

  // ── 1. names ──
  const qNames = (await query(
    `SELECT q.id, q.quote_number, c.name, c.company_name, c.email, c.phone
       FROM quotations q JOIN customers c ON c.id = q.customer_id
      WHERE q.deleted_at IS NULL AND COALESCE(NULLIF(q.customer_name,''),'') = ''`)).rows
  const iNames = (await query(
    `SELECT i.id, i.invoice_number, c.name
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.deleted_at IS NULL AND COALESCE(NULLIF(i.customer_name,''),'') = ''`)).rows

  // ── 2. buyer — only where the written name matches exactly one live customer ──
  const qBuyer = (await query(
    `SELECT q.id, q.quote_number, q.customer_name, c.id AS customer_id, c.customer_number, c.name
       FROM quotations q
       JOIN customers c ON c.deleted_at IS NULL AND lower(btrim(c.name)) = lower(btrim(q.customer_name))
      WHERE q.deleted_at IS NULL AND q.customer_id IS NULL
        AND (SELECT count(*) FROM customers c2 WHERE c2.deleted_at IS NULL
              AND lower(btrim(c2.name)) = lower(btrim(q.customer_name))) = 1`)).rows
  const iBuyer = (await query(
    `SELECT i.id, i.invoice_number, i.customer_name, c.id AS customer_id, c.name
       FROM invoices i
       JOIN customers c ON c.deleted_at IS NULL AND lower(btrim(c.name)) = lower(btrim(i.customer_name))
      WHERE i.deleted_at IS NULL AND i.customer_id IS NULL
        AND (SELECT count(*) FROM customers c2 WHERE c2.deleted_at IS NULL
              AND lower(btrim(c2.name)) = lower(btrim(i.customer_name))) = 1`)).rows

  // ── 3. invoice -> quotation, through the order that holds both ──
  const links = (await query(
    `SELECT i.id, i.invoice_number, q.id AS quote_id, q.quote_number, o.order_number
       FROM invoices i
       JOIN orders o     ON o.invoice_id = i.id AND o.deleted_at IS NULL
       JOIN quotations q ON q.id = o.quotation_id AND q.deleted_at IS NULL
      WHERE i.deleted_at IS NULL AND i.quote_id IS NULL`)).rows

  // ── 4. lines — documents with none, whose order has some ──
  const emptyDocs = (await query(
    `SELECT o.id AS order_id, o.order_number, o.order_type::text AS order_type,
            q.id AS quote_id, q.quote_number, i.id AS invoice_id, i.invoice_number,
            (q.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE quotation_id = q.id)) AS q_empty,
            (i.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice_items   WHERE invoice_id   = i.id)) AS i_empty,
            q.notes LIKE 'Raised from ORD-%' AS q_mine, i.notes LIKE 'Raised from ORD-%' AS i_mine
       FROM orders o
       LEFT JOIN quotations q ON q.id = o.quotation_id AND q.deleted_at IS NULL
       LEFT JOIN invoices   i ON i.id = o.invoice_id   AND i.deleted_at IS NULL
      WHERE o.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM order_items_dtf       WHERE order_id = o.id)
          OR EXISTS (SELECT 1 FROM order_items_apparel   WHERE order_id = o.id)
          OR EXISTS (SELECT 1 FROM order_items_gangsheet WHERE order_id = o.id))`)).rows
  const fillQ = emptyDocs.filter(d => d.q_empty)
  const fillI = emptyDocs.filter(d => d.i_empty)

  console.log(`\n${apply ? 'LIKH RAHA HOON' : 'DRY RUN — kuch nahi likha jayega'}\n`)
  say('1. quotation par naam likhenge', qNames.length)
  say('   invoice par naam likhenge', iNames.length)
  say('2. quotation customer se jorenge', qBuyer.length)
  say('   invoice customer se jorenge', iBuyer.length)
  say('3. invoice -> quotation link', links.length)
  say('4. quotation me lines dalenge', `${fillQ.length} (${fillQ.filter(d => d.q_mine).length} meri banai hui)`)
  say('   invoice me lines dalenge', `${fillI.length} (${fillI.filter(d => d.i_mine).length} meri banai hui)`)
  for (const b of [...qBuyer, ...iBuyer])
    console.log(`\n  jora: ${b.quote_number || b.invoice_number} "${b.customer_name}" -> ${b.name}`)

  if (!apply) { console.log('\nLikhne ke liye --apply lagayein.\n'); await pool.end(); return }

  await query('BEGIN')
  try {
    for (const q of qNames)
      await query(`UPDATE quotations SET customer_name = $2, company_name = COALESCE(NULLIF(company_name,''), $3),
                          billing_email = COALESCE(NULLIF(billing_email,''), $4),
                          contact_number = COALESCE(NULLIF(contact_number,''), $5), updated_at = NOW()
                    WHERE id = $1`, [q.id, q.name, q.company_name || null, q.email || null, q.phone || null])
    for (const i of iNames)
      await query(`UPDATE invoices SET customer_name = $2, updated_at = NOW() WHERE id = $1`, [i.id, i.name])
    for (const b of qBuyer)
      await query(`UPDATE quotations SET customer_id = $2, updated_at = NOW() WHERE id = $1`, [b.id, b.customer_id])
    for (const b of iBuyer)
      await query(`UPDATE invoices SET customer_id = $2, updated_at = NOW() WHERE id = $1`, [b.id, b.customer_id])
    for (const l of links)
      await query(`UPDATE invoices SET quote_id = $2, updated_at = NOW() WHERE id = $1`, [l.id, l.quote_id])

    // The three order line shapes each describe their work differently, so each
    // is flattened into the one line the lists read.
    const LINES = {
      dtf: `SELECT COALESCE(NULLIF(artwork_name,''),'DTF transfer')
                   || CASE WHEN COALESCE(size,'') <> '' THEN ' (' || size || ')' ELSE '' END,
                   qty, unit_price, amount, sort_order, size, artwork_no, 'dtf'
              FROM order_items_dtf WHERE order_id = $1`,
      apparel: `SELECT COALESCE(NULLIF(item,''),'Apparel')
                   || CASE WHEN COALESCE(color,'') <> '' THEN ' - ' || color ELSE '' END,
                   qty, unit_price, amount, sort_order, size, artwork_no, 'apparel'
              FROM order_items_apparel WHERE order_id = $1`,
      gangsheet: `SELECT 'Gang sheet'
                   || CASE WHEN COALESCE(size,'') <> '' THEN ' (' || size || ')' ELSE '' END,
                   qty, price_per_sheet, amount, sort_order, size, NULL, 'gangsheet'
              FROM order_items_gangsheet WHERE order_id = $1`,
    }
    for (const [kind, select] of Object.entries(LINES)) {
      for (const d of fillQ)
        await query(`INSERT INTO quotation_items
                       (quotation_id, description, qty, unit_price, amount, sort_order, sizes, artwork_no, category)
                     SELECT $2, s.* FROM (${select}) s(d,q,u,a,so,sz,aw,cat)`, [d.order_id, d.quote_id])
      for (const d of fillI)
        await query(`INSERT INTO invoice_items
                       (invoice_id, description, qty, unit_price, amount, sort_order, sizes, artwork_no, category)
                     SELECT $2, s.* FROM (${select}) s(d,q,u,a,so,sz,aw,cat)`, [d.order_id, d.invoice_id])
    }
    await query('COMMIT')
  } catch (e) { await query('ROLLBACK'); throw e }
  console.log('\nhogaya\n')
  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
