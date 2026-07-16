/*
 * Build a complete historical commercial chain from the imported DTF PO master:
 * quotation -> order -> invoice/payment -> existing purchase order.
 * The source-entry keys make this safe to run repeatedly.
 */
require('dotenv').config()
const { getClient, pool } = require('../src/config/db')

const SOURCE = 'decoinks_dtf_po_master_apr_jun_2026'
const CHAIN_SOURCE = 'decoinks_dtf_commercial_chain_apr_jun_2026'
const dryRun = process.argv.includes('--dry-run')

const num = value => Number(value || 0)
const cents = value => Math.round(num(value) * 100)
const money = value => (value / 100).toFixed(2)
const suffix = poNumber => String(poNumber).replace(/^TSI\s+/i, '').replace(/[^A-Za-z0-9-]/g, '-')

function allocate(totalValue, items) {
  const totalCents = cents(totalValue)
  const weights = items.map(item => Math.max(0, num(item.qty_ordered)))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  if (!items.length) return []
  if (!weightTotal || !totalCents) return items.map(() => 0)
  let used = 0
  return items.map((_, index) => {
    const share = index === items.length - 1
      ? totalCents - used
      : Math.floor((totalCents * weights[index]) / weightTotal)
    used += share
    return share
  })
}

async function main() {
  const client = await getClient()
  const stats = { quotations: 0, orders: 0, invoices: 0, payments: 0, items_per_module: 0, linked_pos: 0, skipped: 0 }
  try {
    await client.query('BEGIN')
    const beforeLeads = (await client.query(
      `SELECT COUNT(*)::int AS count, md5(string_agg(id::text, ',' ORDER BY id)) AS hash FROM leads`
    )).rows[0]
    const user = (await client.query(`SELECT id FROM users WHERE is_active=TRUE ORDER BY created_at LIMIT 1`)).rows[0]
    if (!user) throw new Error('No active application user found')

    const { rows: pos } = await client.query(
      `SELECT po.*, c.name AS customer_name, c.email AS customer_email,
              COALESCE(c.mobile_number,c.phone,c.company_phone_number) AS customer_phone,
              s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN customers c ON c.id=po.customer_id
       LEFT JOIN suppliers s ON s.id=po.supplier_id
       WHERE po.source_system=$1 AND po.deleted_at IS NULL
       ORDER BY po.order_date,po.source_entry_index,po.created_at`,
      [SOURCE]
    )

    for (const po of pos) {
      const sourceKey = `${CHAIN_SOURCE}:${po.source_entry_key}`
      const existing = await client.query(
        `SELECT q.id AS quote_id,o.id AS order_id,i.id AS invoice_id
         FROM quotations q
         LEFT JOIN orders o ON o.source_entry_key=q.source_entry_key
         LEFT JOIN invoices i ON i.source_entry_key=q.source_entry_key
         WHERE q.source_entry_key=$1`,
        [sourceKey]
      )
      if (existing.rowCount) {
        const chain = existing.rows[0]
        if (chain.order_id) {
          await client.query(`UPDATE purchase_orders SET order_id=$1 WHERE id=$2`, [chain.order_id, po.id])
          await client.query(
            `INSERT INTO po_orders(po_id,order_id,sort_order) VALUES($1,$2,0)
             ON CONFLICT(po_id,order_id) DO NOTHING`,
            [po.id, chain.order_id]
          )
          await client.query(`UPDATE po_gangsheet_fragments SET order_id=$1 WHERE po_id=$2`, [chain.order_id, po.id])
        }
        stats.skipped++
        continue
      }

      const itemResult = await client.query(
        `SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY sort_order,created_at`,
        [po.id]
      )
      const items = itemResult.rows
      if (!items.length) throw new Error(`PO ${po.po_number} has no source items`)

      const payment = num(po.payment_received)
      const sourceShipping = num(po.shipping_charge)
      const isFree = po.source_payment_status === 'Free/Reprint' || payment === 0
      const shipping = isFree ? 0 : Math.min(sourceShipping, payment)
      const product = isFree ? 0 : (po.net_product_amount == null ? Math.max(0, payment - shipping) : num(po.net_product_amount))
      const lineCents = allocate(product, items)
      const docSuffix = suffix(po.po_number)
      const qa = await client.query(
        `SELECT issue_type,details FROM po_import_qa_notes
         WHERE source_system=$1 AND source_po_number=$2 ORDER BY created_at,issue_type`,
        [SOURCE, po.source_po_number]
      )
      const sourceNotes = [
        `Historical DTF record generated from ${po.source_po_number}.`,
        `Source payment status: ${po.source_payment_status || (isFree ? 'Free/Reprint' : 'Paid')}.`,
        isFree && sourceShipping ? `Source sheet listed ${po.currency || 'USD'} ${sourceShipping.toFixed(2)} shipping; no charge was billed on this free/reprint document.` : null,
        po.notes,
        ...qa.rows.map(note => `${note.issue_type}: ${note.details}`),
      ].filter(Boolean).join('\n')

      const quote = (await client.query(
        `INSERT INTO quotations
           (quote_number,status,valid_until,subtotal,discount_pct,discount_amt,tax_pct,tax_amt,total,
            notes,created_by,customer_name,billing_email,contact_number,customer_source,
            shipping_address,billing_address,due_date,sales_agent_id,customer_requirement_summary,
            quote_estimate,order_type,currency,approved_at,estimated_shipping,rush_services,
            payment_terms,customer_notes,customer_id,payment_method,discount_type,discount_value,
            tax_percentage,shipping_amount,source_system,source_entry_key,source_po_number)
         VALUES($1,'Approved',COALESCE($2::date + 7,CURRENT_DATE),$3,0,0,0,0,$4,$5,$6,$7,$8,$9,$10,
                $11,$11,$12,$6,$13,$4,'dtf',$14,COALESCE($2::date,CURRENT_DATE),$15,0,
                $16,$17,$18,'Historical Import','fixed',0,0,$15,$19,$20,$21)
         RETURNING id`,
        [`QT-${docSuffix}`, po.order_date, product, payment, sourceNotes, user.id,
         po.customer_name, po.customer_email, po.customer_phone, SOURCE,
         po.shipping_address, po.expected_date, `DTF Transfers: ${po.total_artworks || 0} artworks across ${po.total_gangsheets || 0} gangsheets.`,
         po.currency || 'USD', shipping, po.payment_terms || 'Paid', sourceNotes, po.customer_id,
         CHAIN_SOURCE, sourceKey, po.source_po_number]
      )).rows[0]
      stats.quotations++

      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        const amountCents = lineCents[index]
        const qty = Math.max(0, num(item.qty_ordered))
        const unitPrice = qty ? amountCents / 100 / qty : 0
        await client.query(
          `INSERT INTO quotation_items
             (quotation_id,description,qty,unit_price,amount,sort_order,sizes,artwork_count,
              product_type,decoration_method,unit,brand)
           VALUES($1,$2,$3,$4,$5,$6,$7,$3,'DTF Transfer','DTF','pcs',$8)`,
          [quote.id, item.item_name, qty, unitPrice.toFixed(2), money(amountCents), index,
           item.artwork_size || null, item.brand || po.brand || null]
        )
      }

      const order = (await client.query(
        `INSERT INTO orders
           (order_number,quotation_id,customer_id,order_type,status,payment_status,payment_method,
            payment_terms,currency,order_date,due_date,rush_services,shipping_charges,subtotal,
            discount_pct,discount_amt,tax_pct,tax_amt,total,notes,shipping_name,shipping_address,
            contact_name,contact_email,contact_phone,assigned_to,created_by,source_system,
            source_entry_key,source_po_number,shipped_at)
         VALUES($1,$2,$3,'dtf','Delivered',$4,'Historical Import',$5,$6,$7,$8,0,$9,$10,
                0,0,0,0,$11,$12,$13,$14,$13,$15,$16,$17,$17,$18,$19,$20,COALESCE($7::date,NOW()::date))
         RETURNING id`,
        [`ORD-${docSuffix}`, quote.id, po.customer_id, isFree ? 'Paid' : 'Paid',
         po.payment_terms || 'Paid', po.currency || 'USD', po.order_date, po.expected_date,
         shipping, product, payment, sourceNotes, po.customer_name, po.shipping_address,
         po.customer_email, po.customer_phone, user.id, CHAIN_SOURCE, sourceKey, po.source_po_number]
      )).rows[0]
      stats.orders++

      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        const amountCents = lineCents[index]
        const qty = Math.max(0, num(item.qty_ordered))
        const unitPrice = qty ? amountCents / 100 / qty : 0
        await client.query(
          `INSERT INTO order_items_dtf
             (order_id,artwork_name,size,qty,unit_price,amount,sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [order.id, item.source_artwork_no ? `${item.source_artwork_no} - ${item.item_name}` : item.item_name,
           item.artwork_size || null, qty, unitPrice.toFixed(2), money(amountCents), index]
        )
      }

      const invoice = (await client.query(
        `INSERT INTO invoices
           (invoice_number,internal_no,order_id,quote_id,customer_id,status,issue_date,due_date,
            subtotal,discount_amt,tax_amt,total,amount_paid,balance_due,notes,created_by,
            customer_name,billing_email,contact_number,billing_address,shipping_address,order_type,
            payment_terms,payment_method,currency,rush_services,shipping_charges,source_system,
            source_entry_key,source_po_number,paid_at)
         VALUES($1,$2,$3,$4,$5,'Paid',$6,$7,$8,0,0,$9,0,$9,$10,$11,$12,$13,$14,$15,$15,
                'dtf',$16,'Historical Import',$17,0,$18,$19,$20,$21,CASE WHEN $9::numeric>0 THEN COALESCE($6::date,CURRENT_DATE) END)
         RETURNING id`,
        [`INV-${docSuffix}`, `INV-INT-${docSuffix}`, order.id, quote.id, po.customer_id,
         po.order_date, po.expected_date, product, payment, sourceNotes, user.id,
         po.customer_name, po.customer_email, po.customer_phone, po.shipping_address,
         po.payment_terms || 'Paid', po.currency || 'USD', shipping,
         CHAIN_SOURCE, sourceKey, po.source_po_number]
      )).rows[0]
      stats.invoices++

      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        const amountCents = lineCents[index]
        const qty = Math.max(0, num(item.qty_ordered))
        const unitPrice = qty ? amountCents / 100 / qty : 0
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id,description,qty,unit_price,amount,artwork_count,sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [invoice.id, item.source_artwork_no ? `${item.source_artwork_no} - ${item.item_name}` : item.item_name,
           qty, unitPrice.toFixed(2), money(amountCents), qty, index]
        )
      }
      stats.items_per_module += items.length

      if (payment > 0) {
        await client.query(
          `INSERT INTO payments(invoice_id,amount,payment_method,reference_no,paid_at,recorded_by,notes)
           VALUES($1,$2,'Historical Import',$3,COALESCE($4::date,CURRENT_DATE),$5,$6)`,
          [invoice.id, payment, po.source_po_number, po.order_date, user.id, `Payment imported from ${SOURCE}`]
        )
        stats.payments++
      } else {
        await client.query(`UPDATE invoices SET amount_paid=0,balance_due=0,status='Paid' WHERE id=$1`, [invoice.id])
      }

      await client.query(`UPDATE orders SET invoice_id=$1 WHERE id=$2`, [invoice.id, order.id])
      await client.query(`UPDATE purchase_orders SET order_id=$1 WHERE id=$2`, [order.id, po.id])
      await client.query(
        `INSERT INTO po_orders(po_id,order_id,sort_order) VALUES($1,$2,0)
         ON CONFLICT(po_id,order_id) DO NOTHING`,
        [po.id, order.id]
      )
      await client.query(`UPDATE po_gangsheet_fragments SET order_id=$1 WHERE po_id=$2`, [order.id, po.id])
      stats.linked_pos++
    }

    const metrics = (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM quotations WHERE source_system=$1) AS quotations,
         (SELECT COUNT(*)::int FROM orders WHERE source_system=$1) AS orders,
         (SELECT COUNT(*)::int FROM invoices WHERE source_system=$1) AS invoices,
         (SELECT COALESCE(SUM(total),0)::numeric(12,2) FROM invoices WHERE source_system=$1) AS invoice_total,
         (SELECT COALESCE(SUM(amount_paid),0)::numeric(12,2) FROM invoices WHERE source_system=$1) AS paid_total,
         (SELECT COUNT(*)::int FROM purchase_orders WHERE source_system=$2 AND order_id IS NOT NULL) AS linked_pos`,
      [CHAIN_SOURCE, SOURCE]
    )).rows[0]
    const expected = { quotations: 31, orders: 31, invoices: 31, invoice_total: 3034.41, paid_total: 3034.41, linked_pos: 31 }
    for (const [key, value] of Object.entries(expected)) {
      if (Math.abs(num(metrics[key]) - value) > 0.005) throw new Error(`Metric mismatch ${key}: ${metrics[key]} != ${value}`)
    }

    const afterLeads = (await client.query(
      `SELECT COUNT(*)::int AS count, md5(string_agg(id::text, ',' ORDER BY id)) AS hash FROM leads`
    )).rows[0]
    if (beforeLeads.count !== afterLeads.count || beforeLeads.hash !== afterLeads.hash) {
      throw new Error('Lead integrity check failed')
    }

    if (dryRun) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'committed', stats, metrics, leads: afterLeads }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
