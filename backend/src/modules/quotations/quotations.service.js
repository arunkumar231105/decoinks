const { query, getClient } = require('../../config/db')
const { getNextNumber } = require('../../utils/counter')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

function calcTotals(items, discountPct, taxPct = 0, estimatedShipping = 0, rushServices = 0) {
  const itemsTotal = items.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0)
  const subtotal = +(itemsTotal + Number(estimatedShipping) + Number(rushServices)).toFixed(2)
  const discount_amt = +(subtotal * (discountPct / 100)).toFixed(2)
  const total = +(subtotal - discount_amt).toFixed(2)
  return { subtotal, discount_amt, tax_amt: 0, total }
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
  lead_id, supplier_id, order_type, valid_until, discount_pct = 0, notes, items = [], created_by,
  company_name, customer_name, billing_email, contact_number, whatsapp, wechat,
  customer_category, customer_source,
  shipping_country, shipping_state, shipping_city, zip_code, shipping_address, billing_address,
  due_date, sales_agent_id, internal_notes, customer_requirement_summary, quote_estimate,
  estimated_shipping = 0, rush_services = 0, payment_terms, payment_method, customer_notes,
}) {
  const quote_number = await getNextNumber('QT', 'quotations', 'quote_number')
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(items, discount_pct, 0, estimated_shipping, rush_services)

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
         due_date, sales_agent_id, internal_notes, customer_requirement_summary, quote_estimate,
         estimated_shipping, rush_services, payment_terms, payment_method, customer_notes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
       RETURNING *`,
      [
        quote_number, lead_id || null, supplier_id || null, order_type || null, valid_until || null,
        subtotal, discount_pct, discount_amt, 0, 0, total, notes || null, created_by,
        company_name || null, customer_name || null, billing_email || null, contact_number || null,
        whatsapp || null, wechat || null, customer_category || null, customer_source || null,
        shipping_country || null, shipping_state || null, shipping_city || null, zip_code || null,
        shipping_address || null, billing_address || null, due_date || null, sales_agent_id || null,
        internal_notes || null, customer_requirement_summary || null, quote_estimate || null,
        estimated_shipping || 0, rush_services || 0, payment_terms || 'Due on Receipt',
        payment_method || null, customer_notes || null,
      ]
    )
    const qId = rows[0].id
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const amount = +(Number(item.unit_price) * Number(item.qty)).toFixed(2)
      await client.query(
        `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count, front_image, back_image, artwork_image)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [qId, item.description || null, item.qty, item.unit_price, amount, i,
         item.sizes || null, item.colors || null, item.artwork_count ?? 0,
         item.front_image || null, item.back_image || null, item.artwork_image || null]
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
  lead_id, supplier_id, order_type, valid_until, discount_pct = 0, notes, items,
  company_name, customer_name, billing_email, contact_number, whatsapp, wechat,
  customer_category, customer_source, shipping_country, shipping_state, shipping_city,
  zip_code, shipping_address, billing_address, due_date, sales_agent_id, internal_notes,
  customer_requirement_summary, quote_estimate,
  estimated_shipping, rush_services, payment_terms, payment_method, customer_notes,
}, actorId) {
  const itemList = items ?? []
  const { subtotal, discount_amt, tax_amt, total } = calcTotals(itemList, discount_pct, 0, estimated_shipping, rush_services)
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
           estimated_shipping=COALESCE($31, estimated_shipping),
           rush_services=COALESCE($32, rush_services),
           payment_terms=COALESCE($33, payment_terms),
           payment_method=COALESCE($34, payment_method),
           customer_notes=COALESCE($35, customer_notes),
           updated_at=NOW()
       WHERE id=$36
       RETURNING id`,
      [
        lead_id || null, supplier_id || null, order_type || null, valid_until || null,
        subtotal, discount_pct, discount_amt, 0, 0, total, notes || null,
        company_name || null, customer_name || null, billing_email || null, contact_number || null,
        whatsapp || null, wechat || null, customer_category || null, customer_source || null,
        shipping_country || null, shipping_state || null, shipping_city || null, zip_code || null,
        shipping_address || null, billing_address || null, due_date || null, sales_agent_id || null,
        internal_notes || null, customer_requirement_summary || null, quote_estimate || null,
        estimated_shipping != null ? estimated_shipping : null,
        rush_services != null ? rush_services : null,
        payment_terms || null,
        payment_method || null,
        customer_notes || null,
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
          `INSERT INTO quotation_items (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count, front_image, back_image, artwork_image)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id, item.description || null, item.qty, item.unit_price, amount, i,
           item.sizes || null, item.colors || null, item.artwork_count ?? 0,
           item.front_image || null, item.back_image || null, item.artwork_image || null]
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
  // Block if an invoice or order has been generated from this quotation
  const { rows: downstream } = await query(
    `SELECT 'invoice' AS kind FROM invoices WHERE quote_id = $1
     UNION ALL
     SELECT 'order'   AS kind FROM orders   WHERE quotation_id = $1
     LIMIT 1`,
    [id]
  )
  if (downstream[0]) {
    throw Object.assign(
      new Error(`This quotation has a linked ${downstream[0].kind} and cannot be deleted. Delete the ${downstream[0].kind} first.`),
      { statusCode: 409 }
    )
  }

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

async function convertToInvoice(quoteId, actorId) {
  // Idempotency: return existing invoice if one already exists for this quote
  const { rows: existing } = await query(
    `SELECT i.*, c.name AS supplier_name, q.quote_number
     FROM invoices i
     LEFT JOIN suppliers c ON c.id = i.supplier_id
     LEFT JOIN quotations q ON q.id = i.quote_id
     WHERE i.quote_id = $1
     ORDER BY i.created_at
     LIMIT 1`,
    [quoteId]
  )
  if (existing[0]) {
    return { invoice: existing[0], alreadyExisted: true }
  }

  // Verify quote exists
  const { rows: qRows } = await query(
    `SELECT id, quote_number FROM quotations WHERE id = $1`, [quoteId]
  )
  if (!qRows[0]) throw Object.assign(new Error('Quotation not found'), { statusCode: 404 })

  // Delegate to invoice service (it reads totals from the quote automatically)
  const invoiceSvc = require('../invoices/invoices.service')
  const invoice = await invoiceSvc.create({ quote_id: quoteId, created_by: actorId })
  return { invoice, alreadyExisted: false }
}

// ── CSV Bulk Upload ───────────────────────────────────────────────────────────

// Case-insensitive header normaliser
function normaliseHeader(h) {
  return h.toLowerCase().replace(/[\s_\-]+/g, '')
}

// Map normalised header → quotation field name
const HEADER_MAP = {
  customername:      'customer_name',
  customer:          'customer_name',
  companyname:       'company_name',
  company:           'company_name',
  email:             'billing_email',
  billingemail:      'billing_email',
  phone:             'contact_number',
  contactnumber:     'contact_number',
  contact:           'contact_number',
  whatsapp:          'whatsapp',
  wechat:            'wechat',
  category:          'customer_category',
  buyertype:         'customer_category',
  customercategory:  'customer_category',
  source:            'customer_source',
  customersource:    'customer_source',
  country:           'shipping_country',
  state:             'shipping_state',
  city:              'shipping_city',
  zip:               'zip_code',
  zipcode:           'zip_code',
  shippingaddress:   'shipping_address',
  address:           'shipping_address',
  billingaddress:    'billing_address',
  duedate:           'due_date',
  deliverydate:      'due_date',
  notes:             'internal_notes',
  internalnotes:     'internal_notes',
  estimate:          'quote_estimate',
  quoteestimate:     'quote_estimate',
  status:            'status',
  // line-item fields (prefixed li_)
  product:           'li_description',
  producttype:       'li_description',
  item:              'li_description',
  description:       'li_description',
  qty:               'li_qty',
  quantity:          'li_qty',
  unitprice:         'li_unit_price',
  price:             'li_unit_price',
  rate:              'li_unit_price',
  sizes:             'li_sizes',
  colors:            'li_colors',
  artworkcount:      'li_artwork_count',
}

const VALID_STATUSES = ['Draft', 'Sent', 'Approved', 'Rejected', 'Expired']

function parseDate(val) {
  if (!val || !val.trim()) return null
  const d = new Date(val.trim())
  if (isNaN(d.getTime())) return undefined  // undefined = parse error
  return d.toISOString().split('T')[0]
}

function parseNum(val, defaultVal = 0) {
  if (val === undefined || val === null || val === '') return { value: defaultVal, error: null }
  const n = Number(val)
  if (isNaN(n)) return { value: null, error: `"${val}" is not a number` }
  return { value: n, error: null }
}

// Minimal built-in CSV parser — no external dependency needed
function parseCsv(buffer) {
  let text = buffer.toString('utf8')
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const lines = text.split(/\r?\n/)
  const result = []

  // Parse one CSV line (handles quoted fields with commas and escaped quotes)
  function parseLine(line) {
    const fields = []
    let i = 0
    while (i < line.length) {
      if (line[i] === '"') {
        // Quoted field
        let val = ''
        i++ // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2 }
          else if (line[i] === '"') { i++; break }
          else { val += line[i++] }
        }
        fields.push(val.trim())
        if (line[i] === ',') i++
      } else {
        // Unquoted field
        const end = line.indexOf(',', i)
        if (end === -1) { fields.push(line.slice(i).trim()); break }
        fields.push(line.slice(i, end).trim())
        i = end + 1
      }
    }
    return fields
  }

  if (lines.length < 2) return []
  const headers = parseLine(lines[0])
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r].trim()
    if (!line) continue
    const values = parseLine(line)
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = values[idx] ?? '' })
    result.push(obj)
  }
  return result
}

async function bulkParseAndProcess(csvBuffer, { dryRun = false, createdBy = null } = {}) {
  // Parse CSV using built-in parser (no external dependency)
  let rawRows
  try {
    rawRows = parseCsv(Buffer.isBuffer(csvBuffer) ? csvBuffer : Buffer.from(csvBuffer))
  } catch (e) {
    throw Object.assign(new Error(`CSV parse error: ${e.message}`), { statusCode: 422 })
  }

  if (!rawRows || rawRows.length === 0) {
    throw Object.assign(new Error('CSV has no data rows'), { statusCode: 422 })
  }

  // Build column map from actual headers
  const rawHeaders = Object.keys(rawRows[0])
  const headersDetected = rawHeaders
  const colToField = {}
  for (const h of rawHeaders) {
    const norm = normaliseHeader(h)
    if (HEADER_MAP[norm]) colToField[h] = HEADER_MAP[norm]
  }

  const processed = []

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNumber = i + 2  // 1-based, row 1 = header
    const errors = []
    const mappedFields = {}
    const lineItem = {}

    for (const [col, field] of Object.entries(colToField)) {
      const val = row[col] ?? ''
      if (field.startsWith('li_')) {
        const liKey = field.slice(3)
        lineItem[liKey] = val
      } else {
        mappedFields[field] = val
      }
    }

    // --- Validate / coerce fields ---

    // due_date
    if (mappedFields.due_date !== undefined) {
      const parsed = parseDate(mappedFields.due_date)
      if (parsed === undefined && mappedFields.due_date.trim()) {
        errors.push(`due_date: cannot parse date "${mappedFields.due_date}"`)
        mappedFields.due_date = null
      } else {
        mappedFields.due_date = parsed
      }
    }

    // quote_estimate
    if (mappedFields.quote_estimate !== undefined && mappedFields.quote_estimate !== '') {
      const { value, error } = parseNum(mappedFields.quote_estimate, null)
      if (error) errors.push(`quote_estimate: ${error}`)
      else mappedFields.quote_estimate = value
    } else {
      delete mappedFields.quote_estimate
    }

    // status
    if (mappedFields.status !== undefined) {
      const s = (mappedFields.status || '').trim()
      if (s && !VALID_STATUSES.includes(s)) {
        errors.push(`status: "${s}" is not valid; using "Draft"`)
        mappedFields.status = 'Draft'
      } else {
        mappedFields.status = s || 'Draft'
      }
    } else {
      mappedFields.status = 'Draft'
    }

    // Line item: qty
    if (lineItem.qty !== undefined && lineItem.qty !== '') {
      const { value, error } = parseNum(lineItem.qty, 1)
      if (error) { errors.push(`qty: ${error}`); lineItem.qty = null }
      else lineItem.qty = value
    } else {
      lineItem.qty = lineItem.description ? 1 : null
    }

    // Line item: unit_price
    if (lineItem.unit_price !== undefined && lineItem.unit_price !== '') {
      const { value, error } = parseNum(lineItem.unit_price, 0)
      if (error) { errors.push(`unit_price: ${error}`); lineItem.unit_price = null }
      else lineItem.unit_price = value
    } else {
      lineItem.unit_price = 0
    }

    // Line item: artwork_count
    if (lineItem.artwork_count !== undefined && lineItem.artwork_count !== '') {
      const { value, error } = parseNum(lineItem.artwork_count, 0)
      if (error) { errors.push(`artwork_count: ${error}`); lineItem.artwork_count = 0 }
      else lineItem.artwork_count = Math.round(value || 0)
    } else {
      lineItem.artwork_count = 0
    }

    // Null-out empty string mapped fields (absent = NULL)
    for (const k of Object.keys(mappedFields)) {
      if (mappedFields[k] === '') mappedFields[k] = null
    }

    const hasLineItem = !!(lineItem.description && lineItem.description.trim())
    const lineItemClean = hasLineItem ? {
      description:   lineItem.description.trim(),
      qty:           lineItem.qty ?? 1,
      unit_price:    lineItem.unit_price ?? 0,
      sizes:         (lineItem.sizes || null) || null,
      colors:        (lineItem.colors || null) || null,
      artwork_count: lineItem.artwork_count ?? 0,
    } : null

    processed.push({ rowNumber, mappedFields, lineItem: lineItemClean, errors, raw: row })
  }

  const validRows   = processed.filter(r => r.errors.length === 0)
  const invalidRows = processed.filter(r => r.errors.length > 0)

  if (dryRun) {
    return {
      totalRows:        rawRows.length,
      validRows:        validRows.length,
      skippedRows:      invalidRows.length,
      headersDetected,
      recognisedColumns: Object.keys(colToField),
      rows: processed.map(({ rowNumber, mappedFields, lineItem, errors }) =>
        ({ rowNumber, mappedFields, lineItem, errors })
      ),
    }
  }

  // ── Real import ──────────────────────────────────────────────────────────────
  const created = []
  const skipped = []

  for (const { rowNumber, mappedFields, lineItem, errors } of processed) {
    if (errors.length > 0) {
      skipped.push({ rowNumber, errors })
      continue
    }

    const client = await getClient()
    try {
      await client.query('BEGIN')

      const quote_number = await getNextNumber('QT', 'quotations', 'quote_number')
      const items = lineItem ? [lineItem] : []
      const { subtotal, discount_amt, tax_amt, total } = calcTotals(items, 0, 0)

      const { rows } = await client.query(
        `INSERT INTO quotations (
           quote_number, status,
           subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total,
           customer_name, company_name, billing_email, contact_number,
           whatsapp, wechat, customer_category, customer_source,
           shipping_country, shipping_state, shipping_city, zip_code,
           shipping_address, billing_address,
           due_date, internal_notes, quote_estimate,
           created_by
         ) VALUES (
           $1,$2,$3,0,$4,0,$5,$6,
           $7,$8,$9,$10,$11,$12,$13,$14,
           $15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24
         ) RETURNING *`,
        [
          quote_number,
          mappedFields.status || 'Draft',
          subtotal, discount_amt, tax_amt, total,
          mappedFields.customer_name   || null,
          mappedFields.company_name    || null,
          mappedFields.billing_email   || null,
          mappedFields.contact_number  || null,
          mappedFields.whatsapp        || null,
          mappedFields.wechat          || null,
          mappedFields.customer_category || null,
          mappedFields.customer_source   || null,
          mappedFields.shipping_country  || null,
          mappedFields.shipping_state    || null,
          mappedFields.shipping_city     || null,
          mappedFields.zip_code          || null,
          mappedFields.shipping_address  || null,
          mappedFields.billing_address   || null,
          mappedFields.due_date          || null,
          mappedFields.internal_notes    || null,
          mappedFields.quote_estimate != null ? mappedFields.quote_estimate : null,
          createdBy,
        ]
      )

      const qId = rows[0].id
      if (lineItem) {
        const amount = +(lineItem.unit_price * lineItem.qty).toFixed(2)
        await client.query(
          `INSERT INTO quotation_items
             (quotation_id, description, qty, unit_price, amount, sort_order, sizes, colors, artwork_count)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
          [qId, lineItem.description, lineItem.qty, lineItem.unit_price, amount,
           lineItem.sizes || null, lineItem.colors || null, lineItem.artwork_count]
        )
      }

      await client.query('COMMIT')
      created.push({ rowNumber, quote_number, id: qId })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      skipped.push({ rowNumber, errors: [`DB error: ${err.message}`] })
    } finally {
      client.release()
    }
  }

  return {
    created: created.length,
    skipped: skipped.length,
    createdQuotes: created,
    skippedRows: skipped,
  }
}

// CSV template (as a string) for download
function getCsvTemplate() {
  const headers = [
    'customer_name','company_name','email','phone','whatsapp','wechat',
    'category','source','country','state','city','zip',
    'shipping_address','billing_address','due_date','notes','estimate','status',
    'product','qty','unit_price','sizes','colors','artwork_count',
  ]
  const example = [
    'John Smith','Acme Corp','john@acme.com','+1-555-1234','+1-555-1234','',
    'Wholesale','Email','USA','TX','Dallas','75201',
    '123 Main St','123 Main St','2026-12-31','Rush order','500.00','Draft',
    'Custom T-Shirt','100','5.00','S,M,L,XL','Black,White','2',
  ]
  return headers.join(',') + '\n' + example.join(',') + '\n'
}

module.exports = { list, getById, create, update, updateStatus, remove, convertToInvoice, bulkParseAndProcess, getCsvTemplate }
