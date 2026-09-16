/**
 * The CRM's door into Printshop.
 *
 * Agents live in the CRM inbox all day. Asking them to leave the chat, open
 * Printshop and re-type a customer and a quotation loses the thread and gets
 * things typed twice, so the CRM shows Printshop's own forms inside the lead
 * panel and posts the result here.
 *
 * Printshop stays the system of record. These routes do not hold a second copy
 * of the rules: each one calls the very same service the Printshop screens call,
 * so numbering, revisions, totals, duplicate checks and pipeline events are
 * whatever Printshop does today and stay that way when Printshop changes.
 *
 * Reachable only with the service secret (see middleware/serviceAuth), and only
 * these few things are reachable through it.
 */

const { Router } = require('express')
const { serviceAuth } = require('../../middleware/serviceAuth')
const db = require('../../config/db')
const { validate } = require('../../middleware/validate')
const customersSvc = require('../customers/customers.service')
const quotationsSvc = require('../quotations/quotations.service')
const invoicesSvc = require('../invoices/invoices.service')
const paylinks = require('../stripe/paylinks.service')
const ordersSvc = require('../orders/orders.service')
const artworksSvc = require('../artworks/artworks.service')
const { uploadFile } = require('../../config/storage')
const { readArtworkDimensions } = require('../../utils/artworkDimensions')
// The very schemas the Printshop screens post through, so a payload arriving
// from the CRM is checked exactly as one typed into Printshop would be.
const { createSchema: customerCreateSchema } = require('../customers/customers.routes')
const { createSchema: quotationCreateSchema } = require('../quotations/quotations.routes')
const { createSchema: invoiceCreateSchema } = require('../invoices/invoices.routes')

// `agent_email` is ours, not Printshop's — the schemas would strip it, and the
// route needs it to decide who the record belongs to, so it is read before
// validation runs and removed from what the schema sees.
const withoutAgent = (schema) => (req, res, next) => {
  req.agentEmail = req.body?.agent_email || ''
  if (req.body) delete req.body.agent_email
  return validate(schema)(req, res, next)
}

const router = Router()
router.use(serviceAuth)

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)

/**
 * Who to record as the author.
 *
 * A CRM agent and a Printshop user are two accounts; the only thing they share
 * is an email address, so that is what we match on. The quote's printed "Sales
 * Agent" is its created_by, so an unmatched agent would otherwise print as
 * nobody. Falling back to the CRM's own Printshop account (CRM_ACTOR_EMAIL,
 * info@technocas.com by default) says truthfully that the CRM made this record,
 * rather than attributing it to whoever happens to be first in the user table.
 */
async function resolveActor(email) {
  const tried = [String(email || '').trim(), (process.env.CRM_ACTOR_EMAIL || 'info@technocas.com').trim()]
  for (const candidate of tried) {
    if (!candidate) continue
    const { rows } = await db.query(
      `SELECT id, name, email, role FROM users WHERE lower(email) = lower($1) AND is_active LIMIT 1`,
      [candidate]
    )
    if (rows[0]) return rows[0]
  }
  return null   // created_by is nullable; a quote is still worth more than no quote
}

/* ── Customers ───────────────────────────────────────────────────────────── */

/** The customer picker on the CRM's quote form. */
router.get('/customers', wrap(async (req, res) => {
  const q = String(req.query.search || '').trim()
  const { rows } = await db.query(
    `SELECT id, name, customer_number, company_name, email, phone, mobile_number
       FROM customers
      WHERE deleted_at IS NULL
        AND ($1 = '' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%'
             OR customer_number ILIKE '%'||$1||'%' OR company_name ILIKE '%'||$1||'%'
             OR phone ILIKE '%'||$1||'%' OR mobile_number ILIKE '%'||$1||'%')
      ORDER BY (name ILIKE $1||'%') DESC, name
      LIMIT 25`, [q])
  res.json({ data: rows })
}))

/**
 * One customer in full — addresses and contacts included.
 *
 * The quote form fills City/State/ZIP/Country from the default shipping address
 * in this array, not from flat columns, which is why the list route above is not
 * enough to auto-populate a quote.
 */
router.get('/customers/:id', wrap(async (req, res) => {
  res.json({ data: await customersSvc.getById(req.params.id) })
}))

/** Lead becomes a customer. Same call the Printshop New Customer screen makes. */
router.post('/customers', withoutAgent(customerCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const payload = req.body
  const customer = await customersSvc.create({
    ...payload,
    source: payload.source || 'Technocas CRM',
    created_by: actor?.id ?? null,
  })
  res.status(201).json({ data: customer })
}))

/* ── Quotations ──────────────────────────────────────────────────────────── */

/** Create the quotation the agent filled in inside the chat. */
router.post('/quotations', withoutAgent(quotationCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const quote = await quotationsSvc.create({ ...req.body, created_by: actor?.id ?? null })
  res.status(201).json({ data: { ...quote, created_by_name: actor?.name ?? null } })
}))

/**
 * Every quotation this customer has.
 *
 * One customer places more than one order, so the CRM lists their quotations and
 * starts a new one beside them rather than treating a conversation as having a
 * single quote. Ordered newest first, which is the one an agent means.
 */
router.get('/quotations', wrap(async (req, res) => {
  const customerId = String(req.query.customer_id || '').trim()
  if (!customerId) return res.json({ data: [] })
  const { rows } = await db.query(
    `SELECT q.id, q.quote_number, q.status, q.order_type, q.total, q.currency,
            q.revision_number, q.created_at, q.valid_until,
            u.name AS created_by_name,
            (SELECT i.id FROM invoices i WHERE i.quote_id = q.id ORDER BY i.created_at LIMIT 1) AS invoice_id,
            (SELECT i.invoice_number FROM invoices i WHERE i.quote_id = q.id ORDER BY i.created_at LIMIT 1) AS invoice_number
       FROM quotations q
       LEFT JOIN users u ON u.id = q.created_by
      WHERE q.customer_id = $1 AND q.deleted_at IS NULL
      ORDER BY q.created_at DESC
      LIMIT 50`, [customerId])
  res.json({ data: rows })
}))

/** Read a saved quotation back — this is what the CRM's preview renders. */
router.get('/quotations/:id', wrap(async (req, res) => {
  const quote = await quotationsSvc.getById(req.params.id)
  const { rows } = await db.query(
    `SELECT u.name FROM users u WHERE u.id = $1`, [quote.created_by]
  )
  res.json({ data: { ...quote, created_by_name: rows[0]?.name ?? null } })
}))

/**
 * Mark it Sent, once the agent has actually sent it to the customer's chat.
 *
 * Status changes go through updateStatus rather than an UPDATE of our own,
 * because that is where the quote's own rules live — the pipeline event, the
 * sent_at stamp, and on approval the invoice.
 */
router.patch('/quotations/:id/status', wrap(async (req, res) => {
  // The full user, not just an id: updateStatus reads its role to decide whether
  // this transition is allowed. An unattributed status change would skip that
  // check, so refuse rather than quietly bypass a permission.
  const actor = await resolveActor(req.body.agent_email)
  if (!actor) return res.status(503).json({ error: 'No Printshop user to attribute this change to.' })
  const quote = await quotationsSvc.updateStatus(req.params.id, req.body.status, actor)
  res.json({ data: quote })
}))

/* ── Invoices ────────────────────────────────────────────────────────────── */

/**
 * The quotation becomes an invoice.
 *
 * Straight into Printshop's invoice service, which is what guarantees at most
 * ONE invoice per quotation: it takes a per-quote advisory lock, creates the
 * invoice if there is none, refreshes an untouched draft if there is, and
 * refuses with a 409 naming the invoice once money has been taken or an order
 * raised against it. None of that is re-decided here.
 */
router.post('/invoices', withoutAgent(invoiceCreateSchema), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const invoice = await invoicesSvc.create({ ...req.body, created_by: actor?.id ?? null })
  res.status(201).json({ data: invoice })
}))

/** Read one back — both invoice previews, short and long, render from this. */
router.get('/invoices/:id', wrap(async (req, res) => {
  res.json({ data: await invoicesSvc.getById(req.params.id) })
}))

/** Every invoice this customer has. */
router.get('/invoices', wrap(async (req, res) => {
  const customerId = String(req.query.customer_id || '').trim()
  if (!customerId) return res.json({ data: [] })
  const { rows } = await db.query(
    `SELECT i.id, i.invoice_number, i.status, i.order_type,
            i.total, i.amount_paid, i.balance_due, i.currency, i.issue_date,
            i.due_date, i.created_at, i.quote_id, q.quote_number
       FROM invoices i
       LEFT JOIN quotations q ON q.id = i.quote_id
      WHERE COALESCE(i.customer_id, q.customer_id) = $1 AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 50`, [customerId])
  res.json({ data: rows })
}))

/** Sent, once it has actually gone into the customer's chat. */
router.patch('/invoices/:id/status', wrap(async (req, res) => {
  const actor = await resolveActor(req.body.agent_email)
  if (!actor) return res.status(503).json({ error: 'No Printshop user to attribute this change to.' })
  const invoice = await invoicesSvc.updateStatus(req.params.id, req.body.status, actor)
  res.json({ data: invoice })
}))

/* ── Orders → Purchase Orders (BlankTex blank-garment fulfillment) ─────────────
 *
 * BlankTex places the blank-garment order with the supplier (DIGI/RIIN) and then
 * raises the Printshop purchase order against the apparel sales order it fulfils.
 * Like the rest of this file, these hold none of the rules themselves: the PO is
 * created by the very same `orders.service.convertToPO` the Printshop screen uses,
 * so numbering, the po_orders link and pipeline events stay identical.
 */

/**
 * The sales-order picker inside BlankTex's New Order form.
 *
 * Only apparel orders, and only ones that do NOT already have a purchase order —
 * an order whose blanks are already on their way must not be picked and ordered a
 * second time. Newest first, which is the one the agent means.
 */
router.get('/orders', wrap(async (req, res) => {
  const type = String(req.query.type || 'apparel').trim()
  const channel = String(req.query.channel || '').trim()
  const search = String(req.query.search || '').trim()
  // `with_po=1` also lists orders that already have purchase orders, so BlankTex
  // can pick the order and then the specific PO to fill from. Without it the list
  // is exactly as before: only orders still awaiting a PO.
  const withPo = ['1', 'true'].includes(String(req.query.with_po || '').trim().toLowerCase())
  const params = [type]
  let where = `o.deleted_at IS NULL AND o.order_type = $1`
  if (!withPo) {
    where += `
      AND NOT EXISTS (
        SELECT 1 FROM purchase_orders po
        LEFT JOIN po_orders poo ON poo.po_id = po.id
        WHERE (po.order_id = o.id OR poo.order_id = o.id) AND po.deleted_at IS NULL
      )`
  }
  if (channel) { params.push(channel); where += ` AND o.sales_channel = $${params.length}` }
  if (search) {
    params.push(`%${search}%`)
    where += ` AND (o.order_number ILIKE $${params.length} OR cust.name ILIKE $${params.length})`
  }
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.order_type, o.sales_channel, o.status,
            o.order_date, o.total, o.currency,
            cust.name AS customer_name,
            COALESCE((SELECT SUM(qty) FROM order_items_apparel WHERE order_id = o.id), 0)::int AS total_qty,
            (SELECT COUNT(DISTINCT po.id) FROM purchase_orders po
               LEFT JOIN po_orders poo ON poo.po_id = po.id
              WHERE (po.order_id = o.id OR poo.order_id = o.id) AND po.deleted_at IS NULL)::int AS po_count
       FROM orders o
       LEFT JOIN customers cust ON cust.id = o.customer_id
      WHERE ${where}
      ORDER BY o.order_date DESC NULLS LAST, o.created_at DESC
      LIMIT 100`, params)
  res.json({ data: rows })
}))

/**
 * One order in full — items and artworks included — to auto-fill the BlankTex form.
 *
 * A sales order stores the ship-to as free text (`shipping_address`) plus the
 * contact fields; the structured City/State/ZIP an API shipment needs lives on the
 * customer. So the customer's default address is attached as `ship_to`, and
 * BlankTex fills from the order first and falls back to it.
 */
router.get('/orders/:id', wrap(async (req, res) => {
  const order = await ordersSvc.getById(req.params.id)
  let ship_to = null
  if (order.customer_id) {
    const { rows } = await db.query(
      `SELECT name, company_name, email, phone, mobile_number, company_phone_number,
              address_line1, city, state, zip, country
         FROM customers WHERE id = $1 AND deleted_at IS NULL`, [order.customer_id])
    ship_to = rows[0] || null
  }
  res.json({ data: { ...order, ship_to } })
}))

/**
 * Raise the purchase order against this sales order.
 *
 * Idempotent on purpose: convertToPO itself allows several POs per order (one per
 * supplier), but from BlankTex a repeat call means the same blank order being
 * confirmed twice, so if a PO already covers this order we return that one instead
 * of creating a duplicate. Creating the PO is what makes the order read as
 * "PO Issued" on Printshop's board — no order-status write is needed.
 */
router.post('/orders/:id/purchase-order', wrap(async (req, res) => {
  const orderId = req.params.id
  const { rows: existing } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.created_at
       FROM purchase_orders po
       LEFT JOIN po_orders poo ON poo.po_id = po.id
      WHERE (po.order_id = $1 OR poo.order_id = $1) AND po.deleted_at IS NULL
      ORDER BY po.created_at LIMIT 1`, [orderId])
  if (existing[0]) return res.status(200).json({ data: existing[0], already_existed: true })

  const actor = await resolveActor(req.body?.agent_email)
  const { po } = await ordersSvc.convertToPO(orderId, actor?.id ?? null)
  const { rows } = await db.query(
    `SELECT id, po_number, status, created_at FROM purchase_orders WHERE id = $1`, [po.id])
  res.status(201).json({ data: rows[0] || { id: po.id, po_number: po.po_number, status: po.status }, already_existed: false })
}))

/**
 * The purchase orders that cover one sales order — an order can have several
 * (one per supplier, or split shipments). BlankTex shows these after the agent
 * picks the sales order, so the blank order is filled from the exact PO.
 */
router.get('/orders/:id/purchase-orders', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.po_type, po.order_date, po.created_at,
            COALESCE(s.name, po.vendor_name) AS supplier_name,
            COALESCE(it.item_count, 0)::int AS item_count,
            COALESCE(it.total_qty, 0)::int AS total_qty
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS item_count, SUM(qty_ordered) AS total_qty
           FROM purchase_order_items WHERE po_id = po.id
       ) it ON TRUE
      WHERE po.deleted_at IS NULL
        AND (po.order_id = $1
             OR EXISTS (SELECT 1 FROM po_orders poo WHERE poo.po_id = po.id AND poo.order_id = $1))
      ORDER BY po.created_at, po.po_number`, [req.params.id])
  res.json({ data: rows })
}))

/**
 * One purchase order in full, shaped for BlankTex auto-fill: its line items (with
 * the BlankTex catalog codes they were picked from), the sales order(s) it covers
 * with their contact/ship-to text, and a structured `ship_to` address.
 *
 * A PO line that carries no artwork of its own falls back to the images on the
 * sales-order line it was raised from, so nothing typed once must be uploaded twice.
 * The address prefers the PO's chosen address, then the order's, then the customer's.
 */
router.get('/purchase-orders/:id', wrap(async (req, res) => {
  const { rows: poRows } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.po_type, po.po_scope, po.order_id, po.customer_id,
            po.shipping_address, po.shipping_address_id, po.shipping_method, po.carrier
       FROM purchase_orders po
      WHERE po.id = $1 AND po.deleted_at IS NULL`, [req.params.id])
  const po = poRows[0]
  if (!po) return res.status(404).json({ error: 'Purchase order not found' })

  const { rows: orders } = await db.query(
    `SELECT o.id, o.order_number, o.customer_id, o.shipping_name, o.shipping_address,
            o.shipping_address_id, o.contact_name, o.contact_phone, o.contact_email
       FROM orders o
      WHERE o.deleted_at IS NULL
        AND (o.id = $2 OR o.id IN (SELECT order_id FROM po_orders WHERE po_id = $1))
      ORDER BY COALESCE(o.id = $2, FALSE) DESC, o.order_number`, [po.id, po.order_id])

  const { rows: items } = await db.query(
    `SELECT poi.id, poi.item_name AS item, poi.qty_ordered AS qty, poi.color, poi.size,
            poi.brand, poi.catalog_sku, poi.style_description, poi.sort_order,
            st.style_no AS model, st.style_no,
            COALESCE(NULLIF(sc.supplier_color_code, ''), sc.internal_color_code) AS color_code,
            COALESCE(NULLIF(sz.supplier_size_code, ''), sz.size_code) AS size_code,
            COALESCE(NULLIF(poi.front_image, ''), NULLIF(src.front_image, ''))   AS front_image,
            COALESCE(NULLIF(poi.back_image, ''), NULLIF(src.back_image, ''))     AS back_image,
            COALESCE(NULLIF(poi.front_mockup, ''), NULLIF(src.front_mockup, '')) AS front_mockup,
            COALESCE(NULLIF(poi.back_mockup, ''), NULLIF(src.back_mockup, ''))   AS back_mockup
       FROM purchase_order_items poi
       LEFT JOIN blanktex.styles st       ON st.style_id = poi.catalog_style_id
       LEFT JOIN blanktex.style_colors sc ON sc.style_color_id = poi.catalog_color_id
       LEFT JOIN blanktex.style_sizes sz  ON sz.style_size_id = poi.catalog_size_id
       LEFT JOIN order_items_apparel src
              ON poi.source_line_table = 'order_items_apparel' AND src.id = poi.source_line_id
      WHERE poi.po_id = $1
      ORDER BY poi.sort_order, poi.created_at`, [po.id])

  // Many purchase orders were raised before PO lines were saved and hold none.
  // A full PO covers every line of its sales order, so those lines are what it
  // buys. A partial PO with no lines cannot say which pieces it covers — nothing
  // is guessed there (`items_source: 'none'`), the agent adds the items.
  let items_source = items.length ? 'purchase_order' : 'none'
  const primary = orders[0] || null
  if (!items.length && po.po_scope !== 'partial' && orders.length) {
    const { rows: lines } = await db.query(
      `SELECT oi.id, oi.item, oi.qty, oi.color, oi.size, oi.brand, oi.catalog_sku,
              oi.style_description, oi.sort_order,
              COALESCE(st.style_no, oi.model) AS model, st.style_no,
              COALESCE(NULLIF(sc.supplier_color_code, ''), sc.internal_color_code) AS color_code,
              COALESCE(NULLIF(sz.supplier_size_code, ''), sz.size_code) AS size_code,
              oi.front_image, oi.back_image, oi.front_mockup, oi.back_mockup
         FROM order_items_apparel oi
         LEFT JOIN blanktex.styles st       ON st.style_id = oi.catalog_style_id
         LEFT JOIN blanktex.style_colors sc ON sc.style_color_id = oi.catalog_color_id
         LEFT JOIN blanktex.style_sizes sz  ON sz.style_size_id = oi.catalog_size_id
        WHERE oi.order_id = ANY($1::uuid[]) AND oi.qty > 0
        ORDER BY oi.order_id, oi.sort_order`, [orders.map(o => o.id)])
    if (lines.length) { items.push(...lines); items_source = 'sales_order' }
  }
  const customerId = po.customer_id || primary?.customer_id || null
  let ship_to = null
  if (customerId) {
    const { rows } = await db.query(
      `SELECT name, company_name, email, phone, mobile_number, company_phone_number,
              address_line1, city, state, zip, country
         FROM customers WHERE id = $1 AND deleted_at IS NULL`, [customerId])
    ship_to = rows[0] || null
  }
  const addressId = po.shipping_address_id || primary?.shipping_address_id || null
  if (addressId) {
    const { rows } = await db.query(
      `SELECT contact_person, line1, line2, city, state, zipcode, country
         FROM customer_addresses WHERE id = $1`, [addressId])
    const a = rows[0]
    if (a) {
      ship_to = {
        ...(ship_to || {}),
        name: a.contact_person || ship_to?.name || null,
        address_line1: a.line1, address_line2: a.line2,
        city: a.city, state: a.state, zip: a.zipcode, country: a.country,
      }
    }
  }

  res.json({ data: { ...po, orders, order_ids: orders.map(o => o.id), items, items_source, ship_to } })
}))

/* ── Invoice payment links ───────────────────────────────────────────────── */

/**
 * Where the pay page lives. Same source the Printshop admin route uses — a
 * setting, so it can move without a redeploy — falling back to the env.
 */
async function payPageBase() {
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'pay_page_base_url'`)
  const configured = (rows[0]?.value || process.env.PAY_PAGE_BASE_URL || '').trim()
  if (!configured) return null
  return configured.replace(/\/+$/, '')
}

/**
 * The one payment link for an invoice, as the agent needs to see it in the CRM.
 *
 * The same row and the same URL the Printshop admin screen and the customer's
 * Pay Now use — there is one link per invoice and this reads it, minting nothing.
 * `payable` says whether the invoice can be collected online yet (a draft cannot,
 * until it is finalised); `reason` says why not.
 */
router.get('/invoices/:id/payment-link', wrap(async (req, res) => {
  const invoice = await paylinks.getInvoice(req.params.id)
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  const link = await paylinks.findCurrentForInvoice(invoice.id)
  const problem = paylinks.payableProblem(invoice)
  const token = link ? await paylinks.decryptToken(link.token_encrypted) : null
  const base = token ? await payPageBase() : null
  res.json({ data: {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    payable: !problem,
    reason: problem ? problem.message : null,
    amount: Number(invoice.balance_due),
    currency: invoice.currency || 'USD',
    url: token && base ? `${base}/pay/${token}` : null,
  } })
}))

/**
 * Get (or mint) the invoice's payment link, so the agent can copy it or send it
 * to the chat. A draft has no payable link, so this finalises it first — the
 * agent is collecting, which is what Sent means — then hands back the one link
 * Printshop keeps for that invoice. Re-minting is Printshop's job, not ours.
 */
router.post('/invoices/:id/payment-link', withoutAgent(require('zod').object({}).passthrough()), wrap(async (req, res) => {
  const actor = await resolveActor(req.agentEmail)
  const base = await payPageBase()
  if (!base) return res.status(503).json({ error: 'The payment page address is not configured in Printshop.' })

  let invoice = await paylinks.getInvoice(req.params.id)
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

  // A draft cannot be paid online. Finalise it — Draft → Sent — so a link can
  // exist, using Printshop's own status rules (which stamp sent_at and fire the
  // pipeline event). A settled or void invoice is left exactly as it is.
  if (invoice.status === 'Draft') {
    if (!actor) return res.status(503).json({ error: 'No Printshop user to finalise this invoice as.' })
    await invoicesSvc.updateStatus(invoice.id, 'Sent', actor)
    invoice = await paylinks.getInvoice(invoice.id)
  }

  const { link, token } = await paylinks.getOrCreateForInvoice(invoice.id, { createdBy: actor?.id || null })
  await db.query(`UPDATE payment_links SET sent_at = NOW() WHERE id = $1`, [link.id])
  res.json({ data: {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    url: `${base}/pay/${token}`,
    amount: Number(link.amount),
    currency: link.currency,
    expires_at: link.expires_at,
  } })
}))

/* ── Sales orders ────────────────────────────────────────────────────────── */

/** The quotation/invoice becomes a sales order. Same service Printshop uses. */
router.post('/orders/from-invoice/:invoiceId', wrap(async (req, res) => {
  const actor = await resolveActor(req.body?.agent_email)
  // Order type follows the invoice unless the caller names one.
  let orderType = req.body?.order_type
  if (!orderType) {
    const { rows } = await db.query(`SELECT order_type FROM invoices WHERE id = $1`, [req.params.invoiceId])
    orderType = rows[0]?.order_type || 'apparel'
  }
  const { order, alreadyExisted } = await invoicesSvc.convertToOrder(req.params.invoiceId, actor?.id ?? null, orderType)
  res.status(alreadyExisted ? 200 : 201).json({ data: order, alreadyExisted })
}))

/** A sales order the agent starts directly. */
router.post('/orders', wrap(async (req, res) => {
  const actor = await resolveActor(req.body?.agent_email)
  const { agent_email, ...payload } = req.body
  const order = await ordersSvc.create({ ...payload, created_by: actor?.id ?? null })
  res.status(201).json({ data: order })
}))

/** One order in full — items and artworks included. */
router.get('/orders/:id', wrap(async (req, res) => {
  res.json({ data: await ordersSvc.getById(req.params.id) })
}))

/** Every order this customer has. */
router.get('/orders', wrap(async (req, res) => {
  const customerId = String(req.query.customer_id || '').trim()
  if (!customerId) return res.json({ data: [] })
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.order_type, o.status, o.total, o.subtotal,
            o.created_at, o.deadline, o.invoice_id, i.invoice_number
       FROM orders o LEFT JOIN invoices i ON i.id = o.invoice_id
      WHERE o.customer_id = $1 AND o.deleted_at IS NULL
      ORDER BY o.created_at DESC LIMIT 50`, [customerId])
  res.json({ data: rows })
}))

router.patch('/orders/:id/status', wrap(async (req, res) => {
  const actor = await resolveActor(req.body?.agent_email)
  const order = await ordersSvc.updateStatus(req.params.id, req.body.status, actor?.id ?? null)
  res.json({ data: order })
}))

/* ── Order artwork (the one place artwork is captured) ──────────────────────
 *
 * Sent as base64 rather than multipart: the CRM has the image as a data URL
 * already, and a JSON body crosses the service boundary without a file-upload
 * middleware. The artwork service does the rest — MinIO, the AW- number, the
 * version row — exactly as an upload through the Printshop screen would.
 */
router.get('/orders/:id/artworks', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, artwork_no, name, file_url, thumbnail_url, file_type, status, created_at
       FROM artworks WHERE order_id = $1 ORDER BY created_at`, [req.params.id])
  res.json({ data: rows })
}))

router.post('/orders/:id/artworks', wrap(async (req, res) => {
  const actor = await resolveActor(req.body?.agent_email)
  const { name, dataBase64, fileName } = req.body || {}
  if (!dataBase64) return res.status(400).json({ error: 'An artwork image is required.' })
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataBase64))
  const mimetype = m ? m[1] : 'image/png'
  const raw = m ? m[2] : String(dataBase64)
  const buffer = Buffer.from(raw, 'base64')
  const ext = (mimetype.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const originalname = fileName || `${(name || 'artwork').replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`
  const artwork = await artworksSvc.create({
    name: name || originalname.replace(/\.[^.]+$/, ''),
    order_id: req.params.id,
    status: 'Pending Review',
    uploaded_by: actor?.id ?? null,
    file: { buffer, originalname, mimetype, size: buffer.length },
  })
  res.status(201).json({ data: artwork })
}))

router.delete('/orders/:id/artworks/:artworkId', wrap(async (req, res) => {
  await artworksSvc.remove(req.params.artworkId)
  res.json({ data: { ok: true } })
}))

// Generic per-line image upload for the CRM's order form — the same thing
// Printshop's /api/upload/image does for its order lines (front/back artwork,
// mockups, DTF artwork). Takes a base64 data URL, stores it in the same
// 'item-images' bucket, and answers with { url, dimensions } so the line can
// carry the stored URL exactly as Printshop's own form does.
router.post('/upload-image', wrap(async (req, res) => {
  const { dataBase64, fileName } = req.body || {}
  if (!dataBase64) return res.status(400).json({ error: 'An image is required.' })
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataBase64))
  const mimetype = m ? m[1] : 'image/png'
  const buffer = Buffer.from(m ? m[2] : String(dataBase64), 'base64')
  const ext = (mimetype.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const originalname = fileName || `line-image.${ext}`
  let dimensions = null
  try { dimensions = await readArtworkDimensions(buffer) } catch { /* dimensions are optional */ }
  const url = await uploadFile(buffer, originalname, mimetype, 'item-images')
  res.json({ data: { url, dimensions } })
}))

/* ── Shipments ───────────────────────────────────────────────────────────── */

// Fresh carrier status for one shipment, from the CRM's Shipment tab — the same
// refreshTracking the Printshop Shipments screen runs (Shippo lookup, only the
// fields Shippo returned are written, Delivered is never moved back).
const shipmentsSvc = require('../shipments/shipments.service')
router.post('/shipments/:id/track', wrap(async (req, res) => {
  res.json({ data: await shipmentsSvc.refreshTracking(req.params.id) })
}))

/* ── Payments ────────────────────────────────────────────────────────────── */

// A Bank of America Zelle alert, posted by the n8n inbox watcher the moment it
// arrives. zelle.recorder decides — bank-signed only, never twice, adopting a
// row staff already typed. ?dry_run=1 answers what it would do and writes nothing.
// 422 when refused, so n8n's failure branch alerts someone to look.
const zelleRecorder = require('../payments/zelle.recorder')
router.post('/payments/zelle-email', wrap(async (req, res) => {
  const dryRun = req.query.dry_run === '1' || req.body?.dry_run === true
  const result = await zelleRecorder.recordZelleEmail(req.body || {}, { dryRun })
  if (result.status === 'rejected') return res.status(422).json({ error: result.reason, data: result })
  res.status(result.status === 'created' && !dryRun ? 201 : 200).json({ data: result })
}))

module.exports = router
