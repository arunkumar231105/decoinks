const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

function calcTotals(items, discountPct, taxPct) {
  const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0)
  const discount_amt = +(subtotal * (discountPct / 100)).toFixed(2)
  const tax_amt = +((subtotal - discount_amt) * (taxPct / 100)).toFixed(2)
  const total = +(subtotal - discount_amt + tax_amt).toFixed(2)
  return { subtotal: +subtotal.toFixed(2), discount_amt, tax_amt, total }
}

async function list({ page = 1, limit = 10, status = '', supplier_id = '' }) {
  const offset = (page - 1) * limit
  const conditions = []
  const params = []

  if (status)      { params.push(status);      conditions.push(`q.status = $${params.length}`) }
  if (supplier_id) { params.push(supplier_id); conditions.push(`q.supplier_id = $${params.length}`) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(`SELECT COUNT(*) FROM quotations q ${where}`, params)
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT q.*, c.name AS supplier_name, u.name AS created_by_name
     FROM quotations q
     LEFT JOIN suppliers c ON c.id = q.supplier_id
     LEFT JOIN users u ON u.id = q.created_by
     ${where}
     ORDER BY q.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows, total }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT q.*, c.name AS supplier_name FROM quotations q
     LEFT JOIN suppliers c ON c.id = q.supplier_id
     WHERE q.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

  const items = await query(
    `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order`, [id]
  )
  return { ...rows[0], items: items.rows }
}

async function create({
  lead_id, supplier_id, order_type, valid_until, discount_pct = 0, tax_pct = 0, notes, items = [], created_by,
  company_name, customer_name, billing_email, contact_number, whatsapp, wechat,
  customer_category, customer_source,
  shipping_country, shipping_state, shipping_city, zip_code, shipping_address, billing_address,
  due_date, sales_agent_id, internal_notes, customer_requirement_summary, quote_estimate,
}) {
  const quote_number = await getNextNumber('QT', 'quotations', 'quote_number')
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(items, discount_pct, tax_pct)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO quotations (
         quote_number, lead_id, supplier_id, order_type, valid_until,
         subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes, created_by,
         company_name, customer_name, billing_email, contact_number, whatsapp, wechat,
         customer_category, customer_source,
         shipping_country, shipping_state, shipping_city, zip_code, shipping_address, billing_address,
         due_date, sales_agent_id, internal_notes, customer_requirement_summary, quote_estimate
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING *`,
      [
        quote_number, lead_id || null, supplier_id || null, order_type || null, valid_until || null,
        subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes || null, created_by,
        company_name || null, customer_name || null, billing_email || null, contact_number || null,
        whatsapp || null, wechat || null, customer_category || null, customer_source || null,
        shipping_country || null, shipping_state || null, shipping_city || null, zip_code || null,
        shipping_address || null, billing_address || null, due_date || null, sales_agent_id || null,
        internal_notes || null, customer_requirement_summary || null, quote_estimate || null,
      ]
    )
    const qId = rows[0].id
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [qId, item.description || null, item.qty, item.unit_price, amount, i,
         item.sizes || null, item.colors || null, item.artwork_count ?? 0]
      )
    }
    await client.query('COMMIT')
    return getById(qId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function update(id, {
  lead_id, supplier_id, order_type, valid_until, discount_pct = 0, tax_pct = 0, notes, items,
  company_name, customer_name, billing_email, contact_number, whatsapp, wechat,
  customer_category, customer_source, shipping_country, shipping_state, shipping_city,
  zip_code, shipping_address, billing_address, due_date, sales_agent_id, internal_notes,
  customer_requirement_summary, quote_estimate,
}, actorId) {
  const itemList = items ?? []
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(itemList, discount_pct, tax_pct)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: updated } = await client.query(
      `UPDATE quotations
       SET lead_id=$1, supplier_id=$2, order_type=$3, valid_until=$4, subtotal=$5, discount_pct=$6,
           discount_amt=$7, tax_pct=$8, tax_amt=$9, total=$10, notes=$11,
           company_name=$12, customer_name=$13, billing_email=$14, contact_number=$15,
           whatsapp=$16, wechat=$17, customer_category=$18, customer_source=$19,
           shipping_country=$20, shipping_state=$21, shipping_city=$22, zip_code=$23,
           shipping_address=$24, billing_address=$25, due_date=$26, sales_agent_id=$27,
           internal_notes=$28, customer_requirement_summary=$29, quote_estimate=$30,
           updated_at=NOW()
       WHERE id=$31
       RETURNING id`,
      [
        lead_id || null, supplier_id || null, order_type || null, valid_until || null,
        subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, notes || null,
        company_name || null, customer_name || null, billing_email || null, contact_number || null,
        whatsapp || null, wechat || null, customer_category || null, customer_source || null,
        shipping_country || null, shipping_state || null, shipping_city || null, zip_code || null,
        shipping_address || null, billing_address || null, due_date || null, sales_agent_id || null,
        internal_notes || null, customer_requirement_summary || null, quote_estimate || null,
        id,
      ]
    )
    if (!updated[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

    if (items !== undefined) {
      await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id])
      for (let i = 0; i < itemList.length; i++) {
        const item = itemList[i]
        const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
        await client.query(
          `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, item.description || null, item.qty, item.unit_price, amount, i,
           item.sizes || null, item.colors || null, item.artwork_count ?? 0]
        )
      }
    }
    await client.query('COMMIT')
    return getById(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function updateStatus(id, status, actor) {
  // actor may be a full user object { id, role } or just a UUID string (internal calls)
  const actorId   = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  // Fetch current status for transition validation
  const { rows: cur } = await query(`SELECT status FROM quotations WHERE id = $1`, [id])
  if (!cur[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })
  if (actorUser) validateTransition('quotation', cur[0].status, status, actorUser)

  // Generate invoice number outside the transaction (advisory-locked sequence, gaps are OK)
  const invNumber = status === 'Approved' ? await getNextNumber('INV', 'invoices', 'invoice_number') : null

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const approvedAt = status === 'Approved' ? ', approved_at = NOW()' : ''
    const { rows } = await client.query(
      `UPDATE quotations SET status=$1, updated_at=NOW()${approvedAt} WHERE id=$2 RETURNING *`,
      [status, id]
    )
    if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })
    const quote = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'quotation', $2, 'status_changed', $3)`,
      [actorId, id, `Quotation ${quote.quote_number} status changed to ${status}`]
    ).catch(() => {})

    let autoInvoiceId = null
    if (status === 'Approved') {
      // Idempotency check — only create if no invoice already linked to this quote
      const { rows: existing } = await client.query(
        `SELECT id FROM invoices WHERE quote_id = $1 LIMIT 1`, [id]
      )

      if (!existing[0]) {
        const total = +Number(quote.total).toFixed(2)
        const { rows: invRows } = await client.query(
          `INSERT INTO invoices
             (invoice_number, quote_id, supplier_id, issue_date, status,
              subtotal, discount_amt, tax_amt, total, amount_paid, balance_due,
              notes, created_by)
           VALUES ($1,$2,$3,$4,'Sent',$5,$6,$7,$8,0,$8,$9,$10)
           RETURNING id`,
          [
            invNumber, id, quote.supplier_id,
            new Date().toISOString().split('T')[0],
            quote.subtotal, quote.discount_amt, quote.tax_amt, total,
            quote.notes || null, actorId,
          ]
        )
        autoInvoiceId = invRows[0].id

        await client.query(
          `INSERT INTO pipeline_events
             (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
           VALUES ('invoice_created_from_quote','quotations',$1,'invoices',$2,$3,$4)`,
          [id, autoInvoiceId, actorId, JSON.stringify({ quote_number: quote.quote_number, invoice_number: invNumber })]
        )
      }

      // quote_approved event (always, even if invoice already existed)
      await client.query(
        `INSERT INTO pipeline_events
           (event_type, source_table, source_id, triggered_by, metadata)
         VALUES ('quote_approved','quotations',$1,$2,$3)`,
        [id, actorId, JSON.stringify({ quote_number: quote.quote_number })]
      )
    }

    await client.query('COMMIT')
    return { ...quote, status, auto_invoice_id: autoInvoiceId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function remove(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, quote_number FROM quotations WHERE id = $1`, [id]
    )
    if (!rows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

    await client.query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [id])
    await client.query(`DELETE FROM quotations WHERE id = $1`, [id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { list, getById, create, update, updateStatus, remove }
