const { query, getClient } = require('../../config/db')
const { getNextNumber, getNextInvoiceNumber } = require('../../utils/counter')
const { cacheDel } = require('../../config/redis')
const { logPipelineEvent } = require('../../utils/pipelineEvents')
const { validateTransition } = require('../../utils/stateMachine')

// ── Helpers ───────────────────────────────────────────────────────────────────

// Shipping and rush are billed on top of the goods, exactly as the quotation
// and the purchase order compute them. Leaving them out here is what made a
// $125 quote arrive as a $110.16 invoice — the shipping was stored on the row
// and then ignored by the total, and the sales order inherited that total.
function calcTotal(subtotal, discount_amt, tax_amt = 0, shipping_charges = 0, rush_charges = 0) {
  return +(Number(subtotal) - Number(discount_amt) + Number(tax_amt)
           + Number(shipping_charges || 0) + Number(rush_charges || 0)).toFixed(2)
}

function assertPositiveInvoice(total, totalQty) {
  if (!Number.isFinite(Number(total)) || Number(total) <= 0) {
    throw Object.assign(new Error('Invoice total must be greater than zero'), { statusCode: 422 })
  }
  if (!Number.isFinite(Number(totalQty)) || Number(totalQty) <= 0) {
    throw Object.assign(new Error('Invoice total quantity must be greater than zero'), { statusCode: 422 })
  }
}

function normalizeAddress(value) {
  if (value == null) return null
  const parts = String(value).split(',').map(part => part.trim()).filter(Boolean)
  const unique = []
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, ' ')
    const prior = unique.join(', ').toLowerCase().replace(/\s+/g, ' ')
    if (unique.some(existing => existing.toLowerCase() === key) || (key.length >= 5 && prior.includes(key))) continue
    unique.push(part.replace(/\s+/g, ' '))
  }
  return unique.join(', ') || null
}

function bestAddress(...candidates) {
  const addresses = candidates
    .map(value => String(value || '').trim())
    .filter(Boolean)
  const detailed = addresses.find(value =>
    !/^(?:united states(?: of america)?|usa|us)$/i.test(value.replace(/[,\s]+/g, ' ').trim())
  )
  return normalizeAddress(detailed || addresses[0] || null)
}

async function resolveInvoiceQuantity(items, quoteId, orderId) {
  if (Array.isArray(items) && items.length > 0) {
    return items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  }
  if (quoteId) {
    const { rows } = await query(`SELECT COALESCE(SUM(qty),0) AS qty FROM quotation_items WHERE quotation_id=$1`, [quoteId])
    return Number(rows[0].qty)
  }
  if (orderId) {
    const { rows } = await query(
      `SELECT COALESCE(SUM(qty),0) AS qty FROM (
         SELECT qty FROM order_items_apparel WHERE order_id=$1
         UNION ALL SELECT qty FROM order_items_dtf WHERE order_id=$1
         UNION ALL SELECT qty FROM order_items_gangsheet WHERE order_id=$1
       ) quantities`,
      [orderId]
    )
    return Number(rows[0].qty)
  }
  return 0
}

async function logActivity(actorId, invoiceId, action, description) {
  await query(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
     VALUES ($1, 'invoice', $2, $3, $4)`,
    [actorId || null, invoiceId, action, description]
  ).catch(() => {})
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function list({ page = 1, limit = 10, status = '', customer_id = '', supplier_id = '', search = '' }) {
  const offset = (page - 1) * limit
  const conditions = ['i.deleted_at IS NULL']
  const params = []

  const supplierId = supplier_id
  if (status)     { params.push(status);     conditions.push(`i.status = $${params.length}`) }
  if (customer_id) { params.push(customer_id); conditions.push(`i.customer_id = $${params.length}`) }
  else if (supplierId) { params.push(supplierId); conditions.push(`i.supplier_id = $${params.length}`) }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(i.invoice_number ILIKE $${params.length} OR i.source_po_number ILIKE $${params.length} OR i.customer_name ILIKE $${params.length} OR c.name ILIKE $${params.length} OR o.order_number ILIKE $${params.length})`)
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRes = await query(
    `SELECT COUNT(*) FROM invoices i
     LEFT JOIN customers c ON c.id=i.customer_id
     LEFT JOIN orders o ON o.id=i.order_id
     ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count, 10)

  params.push(limit, offset)
  const { rows } = await query(
    `SELECT i.*, COALESCE(c.name, s.name, i.customer_name) AS customer_display_name,
            COALESCE(i.sales_agent_name, u.name) AS sales_agent_display_name,
            o.order_number, q.quote_number,
            COALESCE(item_totals.items_total, 0)::NUMERIC(14,2) AS items_total,
            COALESCE(NULLIF(item_totals.total_qty,0),NULLIF(order_totals.total_qty,0),latest_po.total_artworks,0)::INT AS export_total_qty,
            COALESCE(i.created_at::date,i.issue_date) AS export_entry_date,
            COALESCE(i.due_date,i.issue_date) AS export_due_date,
            CASE WHEN o.payment_status='Paid' THEN 'Paid' ELSE i.status::text END AS export_status,
            CASE WHEN o.payment_status='Paid' THEN i.total ELSE i.amount_paid END AS export_amount_paid,
            CASE WHEN o.payment_status='Paid' THEN 0 ELSE i.balance_due END AS export_balance_due
     FROM invoices i
     LEFT JOIN customers c  ON c.id = i.customer_id
     LEFT JOIN suppliers s  ON s.id = i.supplier_id
     LEFT JOIN LATERAL (
       SELECT ord.* FROM orders ord
       WHERE (ord.id=i.order_id OR ord.invoice_id=i.id) AND ord.deleted_at IS NULL
       ORDER BY (ord.id=i.order_id) DESC,ord.created_at
       LIMIT 1
     ) o ON TRUE
     LEFT JOIN quotations q ON q.id = i.quote_id
     LEFT JOIN users u      ON u.id = i.created_by
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(ii.amount), 0) AS items_total,COALESCE(SUM(ii.qty),0) AS total_qty
       FROM invoice_items ii
       WHERE ii.invoice_id = i.id
     ) item_totals ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(qty),0) AS total_qty FROM (
         SELECT qty FROM order_items_apparel WHERE order_id=o.id
         UNION ALL SELECT qty FROM order_items_dtf WHERE order_id=o.id
         UNION ALL SELECT qty FROM order_items_gangsheet WHERE order_id=o.id
       ) quantities
     ) order_totals ON TRUE
     LEFT JOIN LATERAL (
       SELECT po.total_artworks FROM purchase_orders po
       WHERE po.order_id=o.id AND po.deleted_at IS NULL
       ORDER BY po.created_at DESC LIMIT 1
     ) latest_po ON TRUE
     ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return {
    rows: rows.map(row => ({
      ...row,
      billing_address: normalizeAddress(row.billing_address),
      shipping_address: normalizeAddress(row.shipping_address),
    })),
    total,
  }
}

async function getById(id) {
  const { rows } = await query(
    `SELECT i.*, COALESCE(c.name, s.name, i.customer_name) AS customer_display_name,
            COALESCE(i.sales_agent_name, u.name) AS sales_agent_display_name,
            o.order_number, q.quote_number,
            COALESCE(i.customer_id, q.customer_id, l.customer_id) AS resolved_customer_id,
            COALESCE(NULLIF(trim(c.billing_address), ''), customer_billing.address) AS customer_billing_address,
            COALESCE(customer_shipping.address, concat_ws(', ',
              NULLIF(trim(c.address_line1), ''),
              NULLIF(trim(c.city), ''),
              NULLIF(trim(c.state), ''),
              NULLIF(trim(c.zip), ''),
              NULLIF(trim(c.country), '')
            )) AS customer_shipping_address,
            q.billing_address AS quote_billing_address,
            q.shipping_address AS quote_shipping_address
     FROM invoices i
     LEFT JOIN quotations q ON q.id = i.quote_id
     LEFT JOIN leads l      ON l.id = q.lead_id
     LEFT JOIN customers c  ON c.id = COALESCE(i.customer_id, q.customer_id, l.customer_id)
     LEFT JOIN LATERAL (
       SELECT concat_ws(', ', NULLIF(trim(ca.line1), ''), NULLIF(trim(ca.line2), ''),
                NULLIF(trim(ca.city), ''), NULLIF(trim(ca.state), ''),
                NULLIF(trim(ca.zipcode), ''), NULLIF(trim(ca.country), '')) AS address
       FROM customer_addresses ca
       WHERE ca.customer_id = c.id AND ca.address_type = 'billing'
       ORDER BY ca.is_default DESC, ca.created_at
       LIMIT 1
     ) customer_billing ON TRUE
     LEFT JOIN LATERAL (
       SELECT concat_ws(', ', NULLIF(trim(ca.line1), ''), NULLIF(trim(ca.line2), ''),
                NULLIF(trim(ca.city), ''), NULLIF(trim(ca.state), ''),
                NULLIF(trim(ca.zipcode), ''), NULLIF(trim(ca.country), '')) AS address
       FROM customer_addresses ca
       WHERE ca.customer_id = c.id AND ca.address_type = 'shipping'
       ORDER BY ca.is_default DESC, ca.created_at
       LIMIT 1
     ) customer_shipping ON TRUE
     LEFT JOIN suppliers s  ON s.id = i.supplier_id
     LEFT JOIN orders o     ON o.id = i.order_id
     LEFT JOIN users u      ON u.id = i.created_by
     WHERE i.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })

  const payments = await query(
    `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at ASC`,
    [id]
  )
  // Apparel weight is read-only, derived live from the BlankTex per-size garment
  // weight via the line's existing catalog_size_id (no stored weight, no write
  // or conversion change).
  const items = await query(
    `SELECT ii.*,
            wsp.garment_weight_g AS unit_weight_g,
            ROUND(wsp.garment_weight_g / 453.59237, 2) AS unit_weight_lbs,
            ROUND(wsp.garment_weight_g * ii.qty / 453.59237, 2) AS line_weight_lbs
       FROM invoice_items ii
       LEFT JOIN blanktex.style_size_specs wsp ON wsp.style_size_id = ii.catalog_size_id
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order, ii.created_at`,
    [id]
  ).catch(() => ({ rows: [] }))
  const totalWeightG = items.rows.reduce(
    (sum, i) => sum + (Number(i.unit_weight_g) || 0) * (Number(i.qty) || 0),
    0
  )
  return {
    ...rows[0],
    payments: payments.rows,
    items: items.rows,
    total_weight_g: Math.round(totalWeightG),
    total_weight_lbs: +(totalWeightG / 453.59237).toFixed(2),
  }
}

async function create(fields_in) {
  const { quote_id, order_id, supplier_id, customer_id, issue_date, due_date,
          subtotal, discount_amt, tax_amt,
          notes, created_by, order_type, items } = fields_in
  const fields = fields_in

  let resolvedSubtotal    = Number(subtotal ?? 0)
  let resolvedDiscountAmt = Number(discount_amt ?? 0)
  let resolvedTaxAmt      = Number(tax_amt ?? 0)
  let resolvedSupplierId  = supplier_id || null
  let resolvedCustomerName = fields.customer_name || null
  let resolvedCustomerId = customer_id || null
  let quoteData = null   // full quotation row, used to backfill contact fields + line items
  let customerData = null

  // Pull totals, customer identity and contact fields from the quotation
  // when converting quote → invoice (so nothing is left blank on the invoice).
  if (quote_id) {
    const { rows: qRows } = await query(
      `SELECT q.subtotal, q.discount_amt, q.tax_amt, q.total, q.supplier_id,
              COALESCE(q.customer_id, l.customer_id) AS customer_id,
              q.order_type, q.currency, q.customer_name, q.company_name,
              q.billing_email, q.contact_number, q.shipping_address, q.billing_address,
              q.payment_terms, q.payment_method, q.estimated_shipping, q.rush_services,
              q.customer_notes, q.discount_type, q.discount_value
       FROM quotations q
       LEFT JOIN leads l ON l.id = q.lead_id
       WHERE q.id = $1`,
      [quote_id]
    )
    if (!qRows[0]) throw Object.assign(new Error('Linked quotation not found'), { statusCode: 404 })
    const q = qRows[0]
    quoteData = q
    if (subtotal === undefined) resolvedSubtotal = Number(q.subtotal)
    if (discount_amt === undefined) resolvedDiscountAmt = Number(q.discount_amt)
    if (tax_amt === undefined) resolvedTaxAmt = Number(q.tax_amt)
    if (!resolvedSupplierId) resolvedSupplierId = q.supplier_id
    if (!resolvedCustomerId) resolvedCustomerId = q.customer_id
    if (!resolvedCustomerName) resolvedCustomerName = q.customer_name || q.company_name
  } else if (order_id) {
    const { rows: orderRows } = await query(
      `SELECT subtotal, discount_amt, tax_amt, total, supplier_id
       FROM orders WHERE id = $1 AND deleted_at IS NULL`,
      [order_id]
    )
    if (!orderRows[0]) throw Object.assign(new Error('Linked order not found'), { statusCode: 404 })
    const o = orderRows[0]
    if (subtotal === undefined) resolvedSubtotal = Number(o.subtotal)
    if (discount_amt === undefined) resolvedDiscountAmt = Number(o.discount_amt)
    if (tax_amt === undefined) resolvedTaxAmt = Number(o.tax_amt)
    if (!resolvedSupplierId) resolvedSupplierId = o.supplier_id
  }

  if (resolvedCustomerId) {
    const { rows: cRows } = await query(
      `SELECT c.name, c.email, c.company_phone_number, c.mobile_number,
              COALESCE(NULLIF(trim(c.billing_address), ''), customer_billing.address) AS billing_address,
              COALESCE(customer_shipping.address, concat_ws(', ',
                NULLIF(trim(address_line1), ''),
                NULLIF(trim(city), ''),
                NULLIF(trim(state), ''),
                NULLIF(trim(zip), ''),
                NULLIF(trim(country), '')
              )) AS shipping_address
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT concat_ws(', ', NULLIF(trim(ca.line1), ''), NULLIF(trim(ca.line2), ''),
                  NULLIF(trim(ca.city), ''), NULLIF(trim(ca.state), ''),
                  NULLIF(trim(ca.zipcode), ''), NULLIF(trim(ca.country), '')) AS address
         FROM customer_addresses ca
         WHERE ca.customer_id = c.id AND ca.address_type = 'billing'
         ORDER BY ca.is_default DESC, ca.created_at
         LIMIT 1
       ) customer_billing ON TRUE
       LEFT JOIN LATERAL (
         SELECT concat_ws(', ', NULLIF(trim(ca.line1), ''), NULLIF(trim(ca.line2), ''),
                  NULLIF(trim(ca.city), ''), NULLIF(trim(ca.state), ''),
                  NULLIF(trim(ca.zipcode), ''), NULLIF(trim(ca.country), '')) AS address
         FROM customer_addresses ca
         WHERE ca.customer_id = c.id AND ca.address_type = 'shipping'
         ORDER BY ca.is_default DESC, ca.created_at
         LIMIT 1
       ) customer_shipping ON TRUE
       WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [resolvedCustomerId]
    )
    if (!cRows[0]) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
    customerData = cRows[0]
    resolvedCustomerName ||= customerData.name
    fields.billing_email ||= customerData.email
    fields.contact_number ||= customerData.mobile_number || customerData.company_phone_number
  }

  // Also try to get customer name from linked supplier record if still missing
  if (!resolvedCustomerName && resolvedSupplierId) {
    const { rows: sRows } = await query(`SELECT name FROM suppliers WHERE id = $1`, [resolvedSupplierId]).catch(() => ({ rows: [] }))
    if (sRows[0]) resolvedCustomerName = sRows[0].name
  }

  // Same value the INSERTs below store in shipping_charges / rush_charges, so
  // the total can never drift from the line it is printed next to.
  const resolvedShipping = Number(fields.shipping_charges ?? quoteData?.estimated_shipping ?? 0) || 0
  const resolvedRush     = Number(fields.rush_charges) || 0
  const total       = calcTotal(resolvedSubtotal, resolvedDiscountAmt, resolvedTaxAmt, resolvedShipping, resolvedRush)
  const totalQty    = await resolveInvoiceQuantity(items, quote_id, order_id)
  assertPositiveInvoice(total, totalQty)
  const balance_due = total
  const resolvedIssueDate = issue_date || new Date().toISOString().slice(0, 10)
  const resolvedDueDate = due_date || resolvedIssueDate
  const resolvedBillingAddress = bestAddress(
    fields.billing_address,
    quoteData?.billing_address,
    customerData?.billing_address,
    customerData?.shipping_address
  )
  const resolvedShippingAddress = bestAddress(
    fields.shipping_address,
    quoteData?.shipping_address,
    customerData?.shipping_address,
    customerData?.billing_address
  )

  // ── Quote → invoice: create-or-sync under a per-quote advisory lock ──────────
  // Guarantees at most ONE invoice per quotation. Concurrent Approve/convert
  // requests for the same quote serialise on the lock; a repeat either updates
  // the same still-editable draft invoice or returns a locked-invoice conflict.
  // (The order_id / no-quote path below is unchanged.)
  if (quote_id) {
    return await createOrSyncInvoiceFromQuote({
      quote_id, order_id,
      resolvedCustomerName, resolvedSupplierId, resolvedCustomerId,
      resolvedSubtotal, resolvedDiscountAmt, resolvedTaxAmt, total, balance_due,
      resolvedBillingAddress, resolvedShippingAddress,
      issue_date: resolvedIssueDate, due_date: resolvedDueDate, notes, created_by, order_type, items, fields, quoteData,
    })
  }

  const invoice_number = await getNextInvoiceNumber(resolvedCustomerName)

  const { rows } = await query(
    `INSERT INTO invoices
       (invoice_number, internal_no, quote_id, order_id, supplier_id, customer_id, issue_date, due_date,
        subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, amount_paid, balance_due,
        notes, customer_notes, sales_agent_name, created_by,
        customer_name, billing_email, contact_number, billing_address, shipping_address,
        order_type, payment_terms, payment_method, currency, rush_services, rush_charges,
        shipping_charges, discount_type, discount_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
     RETURNING *`,
    [
      invoice_number,
      `INV-INT-${invoice_number}`, quote_id || null, order_id || null, resolvedSupplierId, resolvedCustomerId,
      resolvedIssueDate,
      resolvedDueDate,
      resolvedSubtotal,
      Number(fields.discount_pct ?? (fields.discount_type === 'percentage' ? fields.discount_value : 0)) || 0,
      resolvedDiscountAmt,
      Number(fields.tax_pct) || 0,
      resolvedTaxAmt, total, 0, balance_due,
      notes || null, fields.customer_notes ?? quoteData?.customer_notes ?? null, fields.sales_agent_name || null, created_by,
      // Contact fields: explicit value wins, otherwise fall back to the quotation's
      resolvedCustomerName || null,
      fields.billing_email   ?? quoteData?.billing_email   ?? null,
      fields.contact_number  ?? quoteData?.contact_number  ?? null,
      resolvedBillingAddress,
      resolvedShippingAddress,
      order_type || quoteData?.order_type || null,
      fields.payment_terms  || quoteData?.payment_terms  || 'Due on Receipt',
      fields.payment_method || quoteData?.payment_method || null,
      fields.currency       || quoteData?.currency       || 'USD',
      Number(fields.rush_services ?? quoteData?.rush_services ?? 0),
      Number(fields.rush_charges) || 0,
      Number(fields.shipping_charges ?? quoteData?.estimated_shipping ?? 0),
      fields.discount_type || quoteData?.discount_type || 'percentage',
      Number(fields.discount_value ?? quoteData?.discount_value ?? 0),
    ]
  )

  // Save line items. Explicit items win; otherwise, when converting from a
  // quotation, copy the quotation's line items so the invoice is never blank.
  if (Array.isArray(items) && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      await query(
         `INSERT INTO invoice_items
           (invoice_id, category, description, qty, unit_price, amount, artwork_count, sort_order,
            front_image, back_image, artwork_image, sizes, colors,
            catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku,
            brand, model, product_image, style_description, artwork_no, line_discount, tax_code,
            width_in, height_in, taxable, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [
          rows[0].id,
          it.category || null,
          it.description || null,
          Number(it.qty) || 1,
          Number(it.unit_price) || 0,
          Number(it.amount) || 0,
          Number(it.artwork_count) || 0,
          it.sort_order ?? i,
          it.front_image || null,
          it.back_image  || null,
          it.artwork_image || null,
          it.sizes || null,
          it.colors || null,
          it.catalog_style_id || null,
          it.catalog_color_id || null,
          it.catalog_size_id || null,
          it.catalog_sku || null,
          it.brand || null,
          it.model || null,
          it.product_image || null,
          it.style_description || null,
          it.artwork_no || null,
          Number(it.line_discount) || 0,
          it.tax_code || null,
          it.width_in ?? null,
          it.height_in ?? null,
          it.taxable ?? true,
          it.notes || null,
        ]
      )
    }
  } else if (quote_id) {
    // Copy quotation_items → invoice_items (description, qty, price, images, artwork count)
    await query(
       `INSERT INTO invoice_items
         (invoice_id, category, description, qty, unit_price, amount, artwork_count, sort_order,
          front_image, back_image, artwork_image, sizes, colors,
          catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, brand, model, artwork_no)
       SELECT $1, category, description, qty, unit_price, amount,
              COALESCE(artwork_count, 0), COALESCE(sort_order, 0),
              front_image, back_image, artwork_image, sizes, colors,
              catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, brand, model, artwork_no
       FROM quotation_items WHERE quotation_id = $2
       ORDER BY sort_order, id`,
      [rows[0].id, quote_id]
    ).catch(() => {})
  }

  if (quote_id) {
    await logPipelineEvent({
      event_type: 'invoice_created_from_quote',
      source_table: 'quotations',
      source_id: quote_id,
      target_table: 'invoices',
      target_id: rows[0].id,
      triggered_by: created_by,
    })
  }

  // "Paid" selected on the create form must be represented by a real ledger
  // payment, not only by a visual status. This keeps amount_paid, balance_due,
  // invoice status and every preview/PDF in agreement.
  let createdInvoice = rows[0]
  if (fields.mark_paid) {
    if (total > 0) {
      createdInvoice = await recordPayment(
        rows[0].id,
        {
          amount: total,
          payment_method: fields.payment_method || 'other',
          notes: 'Full payment recorded when invoice was created',
        },
        created_by
      )
    } else {
      const paidResult = await query(
        `UPDATE invoices
         SET status = 'Paid', amount_paid = 0, balance_due = 0,
             paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [rows[0].id]
      )
      createdInvoice = paidResult.rows[0]
    }
  }

  await cacheDel('dashboard:stats')
  return createdInvoice
}

// ── Quote → invoice: shared line-item writer ──────────────────────────────────
// Writes invoice_items using explicit `items` when supplied, otherwise copies the
// quotation's line items. `exec` is a query function bound to the active client so
// the writes participate in the caller's transaction. Errors are NOT swallowed —
// a failed item write must roll the whole conversion back (no orphan invoices).
async function writeInvoiceItems(exec, invoiceId, { items, quote_id }) {
  if (Array.isArray(items) && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      await exec(
        `INSERT INTO invoice_items
           (invoice_id, category, description, qty, unit_price, amount, artwork_count, sort_order,
            front_image, back_image, artwork_image, sizes, colors,
            catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku,
            brand, model, product_image, style_description, artwork_no, line_discount, tax_code,
            width_in, height_in, taxable, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [
          invoiceId,
          it.category || null,
          it.description || null,
          Number(it.qty) || 1,
          Number(it.unit_price) || 0,
          Number(it.amount) || 0,
          Number(it.artwork_count) || 0,
          it.sort_order ?? i,
          it.front_image || null,
          it.back_image  || null,
          it.artwork_image || null,
          it.sizes || null,
          it.colors || null,
          it.catalog_style_id || null,
          it.catalog_color_id || null,
          it.catalog_size_id || null,
          it.catalog_sku || null,
          it.brand || null,
          it.model || null,
          it.product_image || null,
          it.style_description || null,
          it.artwork_no || null,
          Number(it.line_discount) || 0,
          it.tax_code || null,
          it.width_in ?? null,
          it.height_in ?? null,
          it.taxable ?? true,
          it.notes || null,
        ]
      )
    }
  } else if (quote_id) {
    await exec(
      `INSERT INTO invoice_items
         (invoice_id, category, description, qty, unit_price, amount, artwork_count, sort_order,
          front_image, back_image, artwork_image, sizes, colors,
          catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, brand, model, artwork_no)
       SELECT $1, category, description, qty, unit_price, amount,
              COALESCE(artwork_count, 0), COALESCE(sort_order, 0),
              front_image, back_image, artwork_image, sizes, colors,
              catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku, brand, model, artwork_no
       FROM quotation_items WHERE quotation_id = $2
       ORDER BY sort_order, id`,
      [invoiceId, quote_id]
    )
  }
}

// ── Quote → invoice: create-or-sync (transactional, advisory-locked) ──────────
// CASE 1  no invoice for the quote      → create it (invoice + items) atomically.
// CASE 2  invoice exists and is editable → sync header + replace items atomically.
// CASE 3  invoice exists and is locked   → 409 conflict, no writes.
// Editable ⇔ status='Draft' AND no payments AND amount_paid=0 AND no linked order.
async function createOrSyncInvoiceFromQuote(ctx) {
  const {
    quote_id, order_id,
    resolvedCustomerName, resolvedSupplierId, resolvedCustomerId,
    resolvedSubtotal, resolvedDiscountAmt, resolvedTaxAmt, total, balance_due,
    resolvedBillingAddress, resolvedShippingAddress,
    issue_date, due_date, notes, created_by, order_type, items, fields, quoteData,
  } = ctx

  const discountPct = Number(fields.discount_pct ?? (fields.discount_type === 'percentage' ? fields.discount_value : 0)) || 0
  const taxPct      = Number(fields.tax_pct) || 0

  const client = await getClient()
  try {
    await client.query('BEGIN')

    // Serialise all create/convert traffic for THIS quote. Transaction-scoped:
    // released automatically at COMMIT/ROLLBACK. Two concurrent requests cannot
    // both pass the existence check below.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`INV:QUOTE:${quote_id}`])

    // Existing invoice for this quote (+ editability signals), if any.
    const { rows: existingRows } = await client.query(
      `SELECT i.id, i.invoice_number, i.status, i.amount_paid, i.order_id,
              (SELECT COUNT(*)::int FROM payments p WHERE p.invoice_id = i.id) AS payment_count,
              EXISTS (SELECT 1 FROM orders o WHERE o.invoice_id = i.id AND o.deleted_at IS NULL) AS has_active_order
       FROM invoices i
       WHERE i.quote_id = $1
       ORDER BY i.created_at, i.id
       LIMIT 1`,
      [quote_id]
    )
    const existing = existingRows[0]

    if (!existing) {
      // ── CASE 1: create the invoice + items in one transaction ────────────────
      const invoice_number = await getNextInvoiceNumber(resolvedCustomerName)
      const { rows } = await client.query(
        `INSERT INTO invoices
           (invoice_number, internal_no, quote_id, order_id, supplier_id, customer_id, issue_date, due_date,
            subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total, amount_paid, balance_due,
            notes, customer_notes, sales_agent_name, created_by,
            customer_name, billing_email, contact_number, billing_address, shipping_address,
            order_type, payment_terms, payment_method, currency, rush_services, rush_charges,
            shipping_charges, discount_type, discount_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
         RETURNING *`,
        [
          invoice_number, `INV-INT-${invoice_number}`, quote_id, order_id || null, resolvedSupplierId, resolvedCustomerId,
          issue_date || new Date().toISOString().split('T')[0], due_date || null,
          resolvedSubtotal, discountPct, resolvedDiscountAmt, taxPct, resolvedTaxAmt, total, 0, balance_due,
          notes || null, fields.customer_notes ?? quoteData?.customer_notes ?? null, fields.sales_agent_name || null, created_by,
          resolvedCustomerName || null,
          fields.billing_email   ?? quoteData?.billing_email   ?? null,
          fields.contact_number  ?? quoteData?.contact_number  ?? null,
          resolvedBillingAddress, resolvedShippingAddress,
          order_type || quoteData?.order_type || null,
          fields.payment_terms  || quoteData?.payment_terms  || 'Due on Receipt',
          fields.payment_method || quoteData?.payment_method || null,
          fields.currency       || quoteData?.currency       || 'USD',
          Number(fields.rush_services ?? quoteData?.rush_services ?? 0),
          Number(fields.rush_charges) || 0,
          Number(fields.shipping_charges ?? quoteData?.estimated_shipping ?? 0),
          fields.discount_type || quoteData?.discount_type || 'percentage',
          Number(fields.discount_value ?? quoteData?.discount_value ?? 0),
        ]
      )
      await writeInvoiceItems(client.query.bind(client), rows[0].id, { items, quote_id })
      await client.query('COMMIT')

      // Post-commit, best-effort (not part of the atomic guarantee) — matches
      // the prior create() semantics for the quote path.
      await logPipelineEvent({
        event_type: 'invoice_created_from_quote',
        source_table: 'quotations',
        source_id: quote_id,
        target_table: 'invoices',
        target_id: rows[0].id,
        triggered_by: created_by,
      })

      let createdInvoice = rows[0]
      if (fields.mark_paid) {
        if (total > 0) {
          createdInvoice = await recordPayment(
            rows[0].id,
            {
              amount: total,
              payment_method: fields.payment_method || 'other',
              notes: 'Full payment recorded when invoice was created',
            },
            created_by
          )
        } else {
          const paidResult = await query(
            `UPDATE invoices
             SET status = 'Paid', amount_paid = 0, balance_due = 0,
                 paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [rows[0].id]
          )
          createdInvoice = paidResult.rows[0]
        }
      }

      await cacheDel('dashboard:stats')
      createdInvoice._action = 'created'   // signal to UI: newly created (not synced)
      return createdInvoice
    }

    // Existing invoice → is it still a safely-editable draft?
    const editable =
      existing.status === 'Draft' &&
      existing.payment_count === 0 &&
      Number(existing.amount_paid) === 0 &&
      existing.order_id == null &&
      existing.has_active_order === false

    if (!editable) {
      // ── CASE 3: locked — do not overwrite, do not duplicate ──────────────────
      // Roll back happens in catch; surface a 409 naming the existing invoice.
      throw Object.assign(
        new Error(
          `An invoice (${existing.invoice_number}) already exists for this quotation and can no longer be modified ` +
          `(id ${existing.id}, status ${existing.status}). It has a payment, balance, or linked sales order.`
        ),
        { statusCode: 409 }
      )
    }

    // ── CASE 2: sync header + replace items on the existing draft, atomically ──
    const { rows: updRows } = await client.query(
      `UPDATE invoices SET
         supplier_id=$2, customer_id=$3, customer_name=$4, billing_email=$5, contact_number=$6,
         billing_address=$7, shipping_address=$8, order_type=$9,
         subtotal=$10, discount_pct=$11, discount_amt=$12, tax_pct=$13, tax_amt=$14,
         total=$15, balance_due=$16, notes=$17, customer_notes=$18, sales_agent_name=$19,
         payment_terms=$20, payment_method=$21, currency=$22,
         rush_services=$23, rush_charges=$24, shipping_charges=$25,
         discount_type=$26, discount_value=$27, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [
        existing.id, resolvedSupplierId, resolvedCustomerId, resolvedCustomerName || null,
        fields.billing_email   ?? quoteData?.billing_email   ?? null,
        fields.contact_number  ?? quoteData?.contact_number  ?? null,
        resolvedBillingAddress, resolvedShippingAddress,
        order_type || quoteData?.order_type || null,
        resolvedSubtotal, discountPct, resolvedDiscountAmt, taxPct, resolvedTaxAmt,
        total, balance_due, notes || null, fields.customer_notes ?? quoteData?.customer_notes ?? null,
        fields.sales_agent_name || null,
        fields.payment_terms  || quoteData?.payment_terms  || 'Due on Receipt',
        fields.payment_method || quoteData?.payment_method || null,
        fields.currency       || quoteData?.currency       || 'USD',
        Number(fields.rush_services ?? quoteData?.rush_services ?? 0),
        Number(fields.rush_charges) || 0,
        Number(fields.shipping_charges ?? quoteData?.estimated_shipping ?? 0),
        fields.discount_type || quoteData?.discount_type || 'percentage',
        Number(fields.discount_value ?? quoteData?.discount_value ?? 0),
      ]
    )
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [existing.id])
    await writeInvoiceItems(client.query.bind(client), existing.id, { items, quote_id })
    await client.query('COMMIT')

    await cacheDel('dashboard:stats')
    updRows[0]._action = 'updated'   // signal to UI: existing invoice was synced
    return updRows[0]
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) { /* nothing to roll back */ }
    throw err
  } finally {
    client.release()
  }
}

async function update(id, fields) {
  const allowed = ['supplier_id', 'issue_date', 'due_date', 'subtotal', 'discount_pct', 'discount_amt', 'tax_pct', 'tax_amt', 'notes', 'customer_notes', 'sales_agent_name', 'quote_id', 'customer_name', 'billing_email', 'contact_number', 'billing_address', 'shipping_address', 'payment_terms', 'payment_method', 'currency', 'rush_services', 'rush_charges', 'shipping_charges', 'discount_type', 'discount_value']
  const sets = []
  const params = []

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(key === 'billing_address' || key === 'shipping_address' ? normalizeAddress(fields[key]) : fields[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  // Rewriting only the lines is a legitimate edit — the header may be unchanged.
  if (!sets.length && !Array.isArray(fields.items)) {
    throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
  }

  const financialFields = ['subtotal', 'discount_amt', 'tax_amt', 'shipping_charges', 'rush_charges']
  if (financialFields.some((f) => fields[f] !== undefined)) {
    const existing = await getById(id)

    // A voided invoice must not have its money rewritten.
    if (existing.status === 'Void') {
      throw Object.assign(new Error('Cannot edit the amounts of a voided invoice'), { statusCode: 409 })
    }

    const newSubtotal    = fields.subtotal     !== undefined ? Number(fields.subtotal)     : Number(existing.subtotal)
    const newDiscountAmt = fields.discount_amt !== undefined ? Number(fields.discount_amt) : Number(existing.discount_amt)
    const newTaxAmt      = fields.tax_amt      !== undefined ? Number(fields.tax_amt)      : Number(existing.tax_amt)
    const newShipping    = fields.shipping_charges !== undefined ? Number(fields.shipping_charges) : Number(existing.shipping_charges || 0)
    const newRush        = fields.rush_charges     !== undefined ? Number(fields.rush_charges)     : Number(existing.rush_charges || 0)
    const newTotal       = calcTotal(newSubtotal, newDiscountAmt, newTaxAmt, newShipping, newRush)
    if (!Number.isFinite(newTotal) || newTotal <= 0) {
      throw Object.assign(new Error('Invoice total must be greater than zero'), { statusCode: 422 })
    }
    const amountPaid     = Number(existing.amount_paid) || 0
    const newBalanceDue  = +(Math.max(0, newTotal - amountPaid)).toFixed(2)

    // Re-derive status so it can't contradict the new balance (e.g. an invoice
    // left 'Paid' while a raised total now leaves a balance owing).
    let newStatus = existing.status
    if (existing.status !== 'Draft') {
      if (newBalanceDue <= 0 && amountPaid > 0)      newStatus = 'Paid'
      else if (amountPaid > 0)                       newStatus = 'Partially Paid'
      else if (existing.status === 'Paid')           newStatus = 'Sent'
    }

    params.push(newTotal);     sets.push(`total = $${params.length}`)
    params.push(newBalanceDue);sets.push(`balance_due = $${params.length}`)
    if (newStatus !== existing.status) {
      params.push(newStatus);  sets.push(`status = $${params.length}`)
    }
  }

  params.push(id)

  // Line items, when the caller sends them. update() used to ignore `items`
  // entirely, so editing an invoice saved the header and silently dropped every
  // change to the lines — which is why the app offered no Edit at all. The
  // header and the lines move together in one transaction, so a failure part
  // way through cannot leave an invoice whose total disagrees with its lines.
  const rewriteItems = Array.isArray(fields.items)
  if (!rewriteItems) {
    const { rows } = await query(
      `UPDATE invoices SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING *`,
      params
    )
    if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    return rows[0]
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const assignments = sets.length ? `${sets.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()'
    const { rows } = await client.query(
      `UPDATE invoices SET ${assignments}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    )
    if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    if (rows[0].status === 'Void') {
      throw Object.assign(new Error('Cannot edit the items of a voided invoice'), { statusCode: 409 })
    }
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id])
    await writeInvoiceItems(client.query.bind(client), id, { items: fields.items, quote_id: rows[0].quote_id })
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) { /* nothing to roll back */ }
    throw err
  } finally {
    client.release()
  }
}

async function copyInvoiceItemsToOrder(q, invoiceId, orderId, orderType) {
  if (orderType === 'apparel') {
    await q.query(
      `INSERT INTO order_items_apparel
         (order_id, category, item, color, size, qty, artwork_no, unit_price, amount,
          front_image, back_image, sort_order, catalog_style_id, catalog_color_id,
          catalog_size_id, catalog_sku, brand, model, product_image, style_description)
       SELECT $2, category, COALESCE(description, 'Apparel Item'), colors, sizes, qty, artwork_no,
              unit_price, amount, front_image, back_image, sort_order,
              catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku,
              brand, model, product_image, style_description
       FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, created_at`,
      [invoiceId, orderId]
    )
  } else if (orderType === 'dtf') {
    await q.query(
      `INSERT INTO order_items_dtf
         (order_id, artwork_name, artwork_no, size, qty, unit_price, amount,
          artwork_image, front_image, back_image, sort_order)
       SELECT $2, COALESCE(description, 'DTF Transfer'), artwork_no, sizes, qty,
              unit_price, amount, COALESCE(artwork_image, front_image), front_image,
              back_image, sort_order
       FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, created_at`,
      [invoiceId, orderId]
    )
  } else if (orderType === 'gangsheet') {
    await q.query(
      `INSERT INTO order_items_gangsheet
         (order_id, size, no_artworks, qty, price_per_sheet, amount,
          front_image, back_image, sort_order)
       SELECT $2, COALESCE(sizes, description, 'Gangsheet'), GREATEST(artwork_count, 1),
              qty, unit_price, amount, COALESCE(front_image, artwork_image), back_image, sort_order
       FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, created_at`,
      [invoiceId, orderId]
    )
  }
}

async function autoCreateOrder(invoiceId, invoice, actorId, clientArg) {
  // Resolve order_type from the linked quotation (if any)
  const q = clientArg || { query: (...a) => query(...a) }
  const { rows: qtyRows } = await q.query(`SELECT COALESCE(SUM(qty),0) AS qty FROM invoice_items WHERE invoice_id=$1`, [invoiceId])
  assertPositiveInvoice(invoice.total, Number(qtyRows[0].qty))
  const { rows: qtRows } = await q.query(
    `SELECT q.order_type, q.id AS quote_id
     FROM invoices i
     LEFT JOIN quotations q ON q.id = i.quote_id
     WHERE i.id = $1`,
    [invoiceId]
  )
  const orderType = qtRows[0]?.order_type
  if (!orderType) return null  // no order_type available — skip auto-creation

  // Idempotency: don't create a second order for the same invoice
  const { rows: existing } = await q.query(
    `SELECT id FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [invoiceId]
  )
  if (existing[0]) return existing[0].id

  const ordNumber = await getNextNumber('ORD', 'orders', 'order_number')
  const total = +Number(invoice.total).toFixed(2)
  const orderDate = new Date().toISOString().split('T')[0]

  const { rows: ordRows } = await q.query(
    `INSERT INTO orders
       (order_number, invoice_id, supplier_id, customer_id, order_type, order_date, entry_date, due_date,
        status, payment_status, amount_paid,
        subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total,
        shipping_charges, rush_services,
        payment_terms, payment_method, currency, contact_name, contact_email,
        contact_phone, shipping_name, shipping_address, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$6,'Confirmed','Paid',$12,$7,$8,$9,$10,$11,$12,$23,$24,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id`,
    [
      ordNumber, invoiceId, invoice.supplier_id, invoice.customer_id, orderType,
      orderDate,
      invoice.subtotal, invoice.discount_pct || 0, invoice.discount_amt,
      invoice.tax_pct || 0, invoice.tax_amt || 0, total,
      invoice.payment_terms, invoice.payment_method, invoice.currency || 'USD',
      invoice.customer_name, invoice.billing_email, invoice.contact_number,
      invoice.customer_name, invoice.shipping_address, invoice.notes,
      actorId,
      Number(invoice.shipping_charges || 0), Number(invoice.rush_services || 0),
    ]
  )
  const orderId = ordRows[0].id
  await copyInvoiceItemsToOrder(q, invoiceId, orderId, orderType)

  await q.query(
    `INSERT INTO pipeline_events
       (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
     VALUES ('order_created_from_invoice','invoices',$1,'orders',$2,$3,$4)`,
    [invoiceId, orderId, actorId, JSON.stringify({ invoice_number: invoice.invoice_number, order_number: ordNumber })]
  )

  return orderId
}

async function updateStatus(id, status, actor) {
  const actorId   = typeof actor === 'string' ? actor : actor.id
  const actorUser = typeof actor === 'string' ? null   : actor

  const { rows: cur } = await query(
    `SELECT i.status,i.total,COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii WHERE ii.invoice_id=i.id),0) AS total_qty
     FROM invoices i WHERE i.id=$1`,
    [id]
  )
  if (!cur[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
  if (actorUser) validateTransition('invoice', cur[0].status, status, actorUser)
  if (status === 'Paid') assertPositiveInvoice(cur[0].total, Number(cur[0].total_qty))

  const ordNumber = status === 'Paid' ? await getNextNumber('ORD', 'orders', 'order_number') : null

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const paidAt = status === 'Paid' ? ', paid_at = COALESCE(paid_at, NOW())' : ''
    const { rows } = await client.query(
      `UPDATE invoices SET status = $1, updated_at = NOW()${paidAt} WHERE id = $2 RETURNING *`,
      [status, id]
    )
    if (!rows[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    const invoice = rows[0]

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
       VALUES ($1, 'invoice', $2, 'status_changed', $3)`,
      [actorId || null, id, `Invoice ${invoice.invoice_number} status changed to ${status}`]
    ).catch(() => {})

    let autoOrderId = null
    if (status === 'Paid') {
      // Resolve order_type from linked quotation
      const { rows: qtRows } = await client.query(
        `SELECT q.order_type FROM invoices i LEFT JOIN quotations q ON q.id = i.quote_id WHERE i.id = $1`,
        [id]
      )
      const orderType = qtRows[0]?.order_type

      if (orderType) {
        // Idempotency
        const { rows: existing } = await client.query(
          `SELECT id FROM orders WHERE invoice_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]
        )

        if (!existing[0]) {
          const total = +Number(invoice.total).toFixed(2)
          const orderDate = new Date().toISOString().split('T')[0]
          const { rows: ordRows } = await client.query(
            `INSERT INTO orders
               (order_number, invoice_id, supplier_id, customer_id, order_type, order_date, entry_date, due_date,
                status, payment_status, amount_paid,
                subtotal, discount_pct, discount_amt, tax_pct, tax_amt, total,
                shipping_charges, rush_services,
                payment_terms, payment_method, currency, contact_name, contact_email,
                contact_phone, shipping_name, shipping_address, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$6,'Confirmed','Paid',$12,$7,$8,$9,$10,$11,$12,$23,$24,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
             RETURNING id`,
            [
              ordNumber, id, invoice.supplier_id, invoice.customer_id, orderType,
              orderDate,
              invoice.subtotal, invoice.discount_pct || 0, invoice.discount_amt,
              invoice.tax_pct || 0, invoice.tax_amt || 0, total,
              invoice.payment_terms, invoice.payment_method, invoice.currency || 'USD',
              invoice.customer_name, invoice.billing_email, invoice.contact_number,
              invoice.customer_name, invoice.shipping_address, invoice.notes,
              actorId,
              Number(invoice.shipping_charges || 0), Number(invoice.rush_services || 0),
            ]
          )
          autoOrderId = ordRows[0].id
          await copyInvoiceItemsToOrder(client, id, autoOrderId, orderType)

          await client.query(
            `INSERT INTO pipeline_events
               (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
             VALUES ('order_created_from_invoice','invoices',$1,'orders',$2,$3,$4)`,
            [id, autoOrderId, actorId, JSON.stringify({ invoice_number: invoice.invoice_number, order_number: ordNumber })]
          )
        } else {
          autoOrderId = existing[0].id
        }
      }

      await client.query(
        `INSERT INTO pipeline_events
           (event_type, source_table, source_id, triggered_by)
         VALUES ('invoice_paid','invoices',$1,$2)`,
        [id, actorId]
      )
    }

    await client.query('COMMIT')
    return { ...invoice, status, auto_order_id: autoOrderId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function recordPayment(id, { amount, payment_method, reference_no = null, notes = null }, actorId) {
  const inv = await getById(id)

  if (inv.status === 'Void') {
    throw Object.assign(new Error('Cannot record payment on a voided invoice'), { statusCode: 409 })
  }
  if (inv.status === 'Paid') {
    throw Object.assign(new Error('This invoice is already fully paid'), { statusCode: 409 })
  }

  // Reject overpayment: a single payment cannot exceed what is still owed.
  // Use the ledger sum (source of truth) rather than the cached amount_paid.
  const { rows: paidRows } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1`,
    [id]
  )
  const alreadyPaid = +Number(paidRows[0].paid).toFixed(2)
  const outstanding = +(Number(inv.total) - alreadyPaid).toFixed(2)
  // 0.01 tolerance for rounding; block anything meaningfully over the balance.
  if (Number(amount) > outstanding + 0.01) {
    throw Object.assign(
      new Error(`Payment of ${Number(amount).toFixed(2)} exceeds the outstanding balance of ${outstanding.toFixed(2)}`),
      { statusCode: 422 }
    )
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO payments (invoice_id, amount, payment_method, reference_no, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, amount, payment_method, reference_no, notes, actorId || null]
    )

    // Recalculate total paid from the payments table (source of truth)
    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = $1`,
      [id]
    )
    const total_paid  = +Number(sumRows[0].total_paid).toFixed(2)
    const balance_due = +(Math.max(0, Number(inv.total) - total_paid)).toFixed(2)

    let newStatus
    if (balance_due <= 0) {
      newStatus = 'Paid'
    } else if (total_paid > 0) {
      newStatus = 'Partially Paid'
    } else {
      newStatus = inv.status === 'Draft' ? 'Sent' : inv.status
    }

    // $3 is used twice — once assigned to the enum column, once compared against
    // a text literal — so Postgres could not settle on one type for it and threw
    // "inconsistent types deduced for parameter $3: text versus invoice_status".
    // Every attempt to record a payment 500'd, which is why an invoice created
    // from a quotation stayed Draft and unpaid. Both uses are cast explicitly.
    const { rows } = await client.query(
      `UPDATE invoices
       SET amount_paid = $1, balance_due = $2, status = $3::invoice_status,
           paid_at = CASE WHEN $3::text = 'Paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [total_paid, balance_due, newStatus, id]
    )

    await client.query(
      `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description, metadata)
       VALUES ($1, 'invoice', $2, 'payment_recorded', $3, $4)`,
      [
        actorId || null, id,
        `Payment of $${Number(amount).toFixed(2)} recorded on invoice ${inv.invoice_number} via ${payment_method}` +
          (balance_due > 0 ? ` — $${balance_due.toFixed(2)} still outstanding` : ' — fully paid'),
        JSON.stringify({ amount, payment_method, reference_no, total_paid, balance_due, new_status: newStatus }),
      ]
    )

    await client.query('COMMIT')

    if (newStatus === 'Paid') {
      await logPipelineEvent({
        event_type: 'invoice_paid',
        source_table: 'invoices',
        source_id: id,
        triggered_by: actorId,
        metadata: { total_paid, payment_method },
      })
      // Best-effort auto-order creation (outside the payment transaction — payment must not fail due to order creation).
      // Failures are logged, not swallowed, so a broken pipeline is visible.
      autoCreateOrder(id, rows[0], actorId, null).catch((err) => {
        console.error(`[pipeline] auto-order creation failed for invoice ${inv.invoice_number} (${id}):`, err.message)
        query(
          `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, description)
           VALUES ($1, 'invoice', $2, 'auto_order_failed', $3)`,
          [actorId || null, id, `Automatic order creation failed after payment: ${err.message}`]
        ).catch(() => {})
      })
    } else if (newStatus === 'Partially Paid') {
      await logPipelineEvent({
        event_type: 'invoice_partially_paid',
        source_table: 'invoices',
        source_id: id,
        triggered_by: actorId,
        metadata: { amount, total_paid, balance_due, payment_method },
      })
    }

    await cacheDel('dashboard:stats')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function remove(id, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: inv } = await client.query(
      `SELECT id, invoice_number FROM invoices WHERE id = $1`, [id]
    )
    if (!inv[0]) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 })
    // Unlink orders and delete payments before deleting invoice (RESTRICT FK)
    await client.query(`UPDATE orders SET invoice_id = NULL WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM payments WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id])
    await client.query(`DELETE FROM invoices WHERE id = $1`, [id])
    await client.query('COMMIT')
    await logActivity(actorId, id, 'deleted', `Invoice ${inv[0].invoice_number} permanently deleted`).catch(() => {})
    return { id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function convertToOrder(invoiceId, actorId, orderType) {
  if (!orderType) throw Object.assign(new Error('order_type is required (apparel, gangsheet, or dtf)'), { statusCode: 422 })

  // Idempotency: return existing order if already created from this invoice
  const { rows: existing } = await query(
    `SELECT o.*, s.name AS supplier_name FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.invoice_id = $1 ORDER BY o.created_at LIMIT 1`,
    [invoiceId]
  )
  if (existing[0]) return { order: existing[0], alreadyExisted: true }

  const orderSvc = require('../orders/orders.service')
  const order = await orderSvc.create({
    invoice_id:  invoiceId,
    order_type:  orderType,
    items:       [],
    created_by:  actorId,
  })
  return { order, alreadyExisted: false }
}

module.exports = { list, getById, create, update, updateStatus, recordPayment, remove, convertToOrder }
