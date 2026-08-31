/**
 * Customer Portal service.
 *
 * Every query is scoped by the customer_id carried in the caller's token — the
 * request never supplies it — so a customer can only ever read their own
 * records. Mirrors the supplier portal module in shape.
 */
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../../config/db')

const TOKEN_TTL = process.env.JWT_CUSTOMER_EXPIRY || '7d'

async function login(username, password) {
  const { rows } = await db.query(
    `SELECT cpu.id, cpu.customer_id, cpu.username, cpu.password_hash, cpu.is_active,
            cpu.must_change_pw, c.name AS customer_name
       FROM customer_portal_users cpu
       JOIN customers c ON c.id = cpu.customer_id
      WHERE lower(cpu.username) = lower($1) AND c.deleted_at IS NULL
      LIMIT 1`,
    [username]
  )
  const user = rows[0]
  // Same message whether the account is missing, disabled or the password is
  // wrong, so the login form cannot be used to discover valid usernames.
  const invalid = Object.assign(new Error('Invalid username or password'), { statusCode: 401 })
  if (!user || !user.is_active) throw invalid
  if (!(await bcrypt.compare(password, user.password_hash))) throw invalid

  await db.query('UPDATE customer_portal_users SET last_login = NOW() WHERE id = $1', [user.id])

  const token = jwt.sign(
    { portalUserId: user.id, customerId: user.customer_id, role: 'customer' },
    process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  )

  return {
    token,
    mustChangePw: user.must_change_pw,
    customer: { id: user.customer_id, name: user.customer_name, username: user.username },
  }
}

async function changePassword(portalUserId, currentPassword, newPassword) {
  const { rows } = await db.query('SELECT password_hash FROM customer_portal_users WHERE id = $1', [portalUserId])
  if (!rows[0]) throw Object.assign(new Error('Account not found'), { statusCode: 404 })
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash)))
    throw Object.assign(new Error('Current password is incorrect'), { statusCode: 400 })
  const hash = await bcrypt.hash(newPassword, 12)
  await db.query(
    'UPDATE customer_portal_users SET password_hash = $1, must_change_pw = FALSE, updated_at = NOW() WHERE id = $2',
    [hash, portalUserId]
  )
}

/* ── Read models the portal screens consume ──────────────────────────────── */

async function getSummary(customerId) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int                                            AS orders,
       COALESCE(SUM(o.total), 0)::numeric                       AS order_value,
       COUNT(*) FILTER (WHERE o.status = 'In Production')::int   AS in_production,
       COUNT(*) FILTER (WHERE o.status = 'Shipped')::int         AS shipped,
       COUNT(*) FILTER (WHERE o.status = 'Delivered')::int              AS delivered
     FROM orders o
     WHERE o.customer_id = $1 AND o.deleted_at IS NULL`,
    [customerId]
  )
  // Artwork counts come from the Nextcloud vault mirror, the same source the
  // portal's Artworks screen lists.
  // Count the same artwork the Artworks screen lists: distinct designs used in
  // this customer's orders, not every file sitting in the vault.
  const { rows: artRows } = await db.query(
    `SELECT count(DISTINCT lower(btrim(name)))::int AS artworks FROM (
       SELECT btrim(regexp_replace(d.artwork_name, '^AW#?[0-9]+\\s*[-–]\\s*', '', 'i')) AS name FROM orders o JOIN order_items_dtf d ON d.order_id = o.id
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL AND d.artwork_name NOT ILIKE '%AGGREGATE%'
       UNION ALL
       SELECT el->>'artwork_no' FROM orders o
         JOIN order_items_gangsheet g ON g.order_id = o.id
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.artworks, '[]'::jsonb)) el
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL
       UNION ALL
       SELECT a.item FROM orders o JOIN order_items_apparel a ON a.order_id = o.id
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL AND COALESCE(a.item,'') NOT ILIKE '%AGGREGATE%'
     ) t WHERE name IS NOT NULL AND btrim(name) <> ''`,
    [customerId]
  )
  // Transfers actually ordered, across every order-item type.
  const { rows: qtyRows } = await db.query(
    `SELECT COALESCE(SUM(q), 0)::int AS transfers_qty FROM (
       SELECT COALESCE(SUM(d.qty), 0) AS q FROM order_items_dtf d
         JOIN orders o ON o.id = d.order_id WHERE o.customer_id = $1 AND o.deleted_at IS NULL
       UNION ALL
       SELECT COALESCE(SUM(g.qty), 0) FROM order_items_gangsheet g
         JOIN orders o ON o.id = g.order_id WHERE o.customer_id = $1 AND o.deleted_at IS NULL
     ) t`,
    [customerId]
  ).catch(() => ({ rows: [{ transfers_qty: 0 }] }))
  const art = { rows: [{ artworks: artRows[0].artworks, transfers_qty: qtyRows[0].transfers_qty }] }

  const s = rows[0]
  return {
    orders: s.orders,
    orderValue: Number(s.order_value),
    inProduction: s.in_production,
    shipped: s.shipped,
    delivered: s.delivered,
    artworks: art.rows[0].artworks,
    transfersQty: art.rows[0].transfers_qty,
    artworksUsedInOrders: art.rows[0].artworks,
  }
}

const D = (v) => (v ? new Date(v).toISOString() : null)

async function getOrders(customerId) {
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.order_date, o.due_date, o.status, o.payment_status,
            o.order_type, o.total, o.payment_method, o.tracking_number,
            i.invoice_number, q.quote_number,
            s.ship_date, s.tracking_number AS shipment_tracking, s.carrier,
            -- The purchase order carries the authoritative artwork / gangsheet
            -- counts from the production sheet. Counting order-item rows was
            -- wrong: a DTF order is often stored as ONE aggregate line, so every
            -- order reported "1 artwork" no matter how many it really had.
            COALESCE(pu.total_artworks, it.qty, 0)::int    AS artwork_count,
            COALESCE(pu.total_gangsheets, 0)::int          AS gangsheets,
            COALESCE(it.qty, pu.total_artworks, 0)::int    AS transfers_qty
       FROM orders o
       LEFT JOIN invoices   i ON i.order_id = o.id
       LEFT JOIN quotations q ON q.id = o.quotation_id
       LEFT JOIN LATERAL (
         -- One parcel can carry several orders (ORD-2026-0061 and ORD-2026-0064
         -- went in the same box). Only the primary order sits on
         -- shipments.order_id; the rest are in shipment_orders. Look through
         -- both, or the other orders in the box show the customer no shipment.
         SELECT sh.ship_date, sh.tracking_number, sh.carrier
           FROM shipments sh
          WHERE sh.deleted_at IS NULL
            AND (sh.order_id = o.id
                 OR EXISTS (SELECT 1 FROM shipment_orders so
                             WHERE so.shipment_id = sh.id AND so.order_id = o.id))
          ORDER BY sh.created_at DESC LIMIT 1
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(lines)::int AS lines, SUM(qty)::int AS qty FROM (
           SELECT COUNT(*) AS lines, COALESCE(SUM(qty), 0) AS qty
             FROM order_items_dtf WHERE order_id = o.id
           UNION ALL
           SELECT COUNT(*), COALESCE(SUM(qty), 0)
             FROM order_items_gangsheet WHERE order_id = o.id
           UNION ALL
           SELECT COUNT(*), COALESCE(SUM(qty), 0)
             FROM order_items_apparel WHERE order_id = o.id
         ) x
       ) it ON TRUE
       LEFT JOIN purchase_orders pu ON pu.order_id = o.id
      WHERE o.customer_id = $1 AND o.deleted_at IS NULL
      ORDER BY o.order_date DESC NULLS LAST, o.created_at DESC`,
    [customerId]
  )

  return rows.map(r => ({
    id: r.id,
    number: r.order_number,
    orderDate: D(r.order_date),
    orderTime: null,
    shipmentDate: D(r.ship_date),
    shipmentTime: null,
    deliveredOn: r.status === 'Delivered' ? D(r.ship_date) : null,
    artworkCount: r.artwork_count,
    gangsheets: r.gangsheets,
    transfersQty: r.transfers_qty,
    value: Number(r.total || 0),
    paymentStatus: r.payment_status || 'Unpaid',
    status: r.status,
    orderType: r.order_type,
    paymentMethod: r.payment_method,
    shippingMethod: r.carrier,
    trackingNo: r.shipment_tracking || r.tracking_number,
    invoiceNo: r.invoice_number,
    salesOrderNo: r.order_number,
    documents: [],
  }))
}

/**
 * Artwork the customer can see: the artwork actually used in their orders.
 *
 * The order-item tables are the only place that records, per artwork, its size,
 * how many transfers were printed and which order it belongs to — the Nextcloud
 * vault mirror carries no order link at all. Rows are grouped by artwork name so
 * one design used across several orders appears once, with each order listed.
 *
 * "AGGREGATE …" rows are skipped: those orders were imported as a single summary
 * line with no per-artwork breakdown, so they describe an order, not an artwork.
 */
const AGGREGATE = '%AGGREGATE%'

/** "W10.5/H13.7" or "10.75x13.9" → '10.5" × 13.7"'. Unknown shapes pass through. */
function prettySize(size, w, h) {
  if (w && h) return `${+w}" × ${+h}"`
  if (!size) return null
  const m = /W\s*([\d.]+)\s*\/\s*H\s*([\d.]+)/i.exec(size) || /([\d.]+)\s*[x×]\s*([\d.]+)/i.exec(size)
  return m ? `${+m[1]}" × ${+m[2]}"` : size
}

async function getArtworks(customerId) {
  const { rows } = await db.query(
    `WITH items AS (
       SELECT btrim(regexp_replace(d.artwork_name, '^AW#?[0-9]+\\s*[-–]\\s*', '', 'i')) AS name, d.size, d.width_inches AS w, d.height_inches AS h,
              d.qty, d.artwork_no, COALESCE(d.artwork_image, d.front_image) AS image,
              o.id AS order_id, o.order_number, o.order_date
         FROM orders o JOIN order_items_dtf d ON d.order_id = o.id
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL AND d.artwork_name NOT ILIKE $2
       UNION ALL
       -- A gangsheet line carries its artworks as a jsonb array of
       -- {artwork_no, size, qty, image}; expand it so each design is its own row.
       SELECT NULLIF(el->>'artwork_no', ''), NULLIF(el->>'size', ''), NULL, NULL,
              COALESCE(NULLIF(el->>'qty','')::int, g.qty), el->>'artwork_no',
              NULLIF(el->>'image', ''),
              o.id, o.order_number, o.order_date
         FROM orders o
         JOIN order_items_gangsheet g ON g.order_id = o.id
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.artworks, '[]'::jsonb)) el
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL
       UNION ALL
       SELECT a.item, a.artwork_size, NULL, NULL,
              a.qty, a.artwork_no, COALESCE(a.front_image, a.product_image),
              o.id, o.order_number, o.order_date
         FROM orders o JOIN order_items_apparel a ON a.order_id = o.id
        WHERE o.customer_id = $1 AND o.deleted_at IS NULL AND COALESCE(a.item,'') NOT ILIKE $2
     )
     SELECT lower(btrim(name)) AS key,
            min(name)                     AS name,
            min(artwork_no)               AS artwork_no,
            (array_agg(image) FILTER (WHERE image IS NOT NULL))[1] AS image,
            (array_agg(size ORDER BY size) FILTER (WHERE size IS NOT NULL))[1] AS size,
            max(w) AS w, max(h) AS h,
            SUM(qty)::int                 AS transfers_qty,
            count(DISTINCT order_id)::int AS order_count,
            min(order_date)               AS first_used,
            max(order_date)               AS last_used,
            json_agg(json_build_object(
              'orderNo', order_number, 'orderDate', order_date, 'transfersQty', qty
            ) ORDER BY order_date DESC)   AS orders
       FROM items
      WHERE name IS NOT NULL AND btrim(name) <> ''
      GROUP BY lower(btrim(name))
      ORDER BY max(order_date) DESC NULLS LAST`,
    [customerId, AGGREGATE]
  )

  // A thumbnail can come from two places, in order of reliability:
  //   1. the artwork code on the order line, matched to the vault's artwork_code
  //      or file name — this is an actual identifier, not a guess;
  //   2. an image stored on the order line itself (MinIO), used as-is.
  // Where the line carries neither — which is the case for artwork captured as
  // free text like "AW#01 - Map" — there is nothing in the data linking it to a
  // vault file, so no preview is shown rather than a wrong one.
  const { rows: assets } = await db.query(
    `SELECT id, file_name, mime_type, file_size_bytes, artwork_code
       FROM artwork_vault_assets
      WHERE customer_id = $1 AND mime_type LIKE 'image/%'`,
    [customerId]
  )
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const byCode = new Map()
  for (const a of assets) {
    if (a.artwork_code) byCode.set(norm(a.artwork_code), a)
  }
  const findAsset = (code) => {
    const key = norm(code)
    if (!key) return null
    if (byCode.has(key)) return byCode.get(key)
    return assets.find(a => norm(a.file_name.replace(/\.[^.]+$/, '')) === key)
        || assets.find(a => norm(a.file_name).includes(key)) || null
  }

  const kb = n => (n == null ? null : n < 1024 * 1024
    ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`)

  return rows.map(r => {
    const asset = findAsset(r.artwork_no)
    const preview = asset ? `/api/portal/artworks/${asset.id}/preview` : (r.image || null)
    return {
      id: asset?.id ?? `item:${r.key}`,
      artworkId: r.artwork_no || null,
      name: r.name,
      fileName: asset?.file_name ?? r.name,
      previewUrl: preview,
      downloadUrl: asset ? `/api/portal/artworks/${asset.id}/file` : (r.image || null),
      size: prettySize(r.size, r.w, r.h),
      transfersQty: r.transfers_qty,
      fileType: asset ? (asset.mime_type || '').split('/')[1]?.toUpperCase() : null,
      fileSize: asset ? kb(Number(asset.file_size_bytes)) : null,
      dateAdded: D(r.last_used),
      timeAdded: null,
      createdBy: null,
      usedInOrders: (r.orders || []).map(o => ({
        orderNo: o.orderNo,
        orderDate: D(o.orderDate),
        transfersQty: o.transfersQty,
      })),
    }
  })
}

/** The stored Nextcloud path for one asset — only if it belongs to this customer. */
async function getAssetPath(customerId, assetId) {
  const { rows } = await db.query(
    'SELECT path, file_name, mime_type FROM artwork_vault_assets WHERE id = $1 AND customer_id = $2',
    [assetId, customerId]
  )
  return rows[0] || null
}

async function getProfile(customerId) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.email, c.phone, c.company_name, c.company, c.website,
            c.job_title, c.country, c.created_at, c.status
       FROM customers c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [customerId]
  )
  const c = rows[0]
  if (!c) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })

  const { rows: addr } = await db.query(
    `SELECT address_type, line1, line2, city, state, zipcode, country
       FROM customer_addresses WHERE customer_id = $1`,
    [customerId]
  )
  const pick = t => {
    const a = addr.find(x => x.address_type === t)
    return a ? { line1: a.line1, line2: a.line2, city: a.city, state: a.state, zip: a.zipcode, country: a.country } : null
  }

  const totals = await getSummary(customerId)

  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    jobTitle: c.job_title,
    country: c.country,
    timeZone: null,
    status: c.status,
    customerSince: D(c.created_at),
    company: {
      name: c.company_name || c.company,
      contactEmail: c.email,
      businessType: null,
      taxId: null,
      website: c.website,
      notes: null,
    },
    billingAddress: pick('billing'),
    shippingAddress: pick('shipping'),
    social: [],
    communication: { email: true, sms: false, whatsapp: false, phone: false },
    account: {
      totalOrders: totals.orders,
      totalArtworks: totals.artworks,
      totalTransfersQty: totals.transfersQty,
      totalSpent: totals.orderValue,
      outstanding: 0,
    },
  }
}


/* ── Invoices ───────────────────────────────────────────────────────────────
 *
 * Draft invoices are never shown. A draft has not been confirmed by staff, so
 * its pricing is not final — showing it would tell the customer a number that
 * may still change, and letting them pay it would collect against figures
 * nobody signed off. Moving Draft -> Sent in the admin app is the moment an
 * invoice becomes the customer's business.
 *
 * The customer link is taken through invoices.customer_id OR the invoice's
 * order, because neither column is populated on every row and using only one
 * hides invoices from the customer they belong to.
 */
const PORTAL_INVOICE_COLUMNS = `
  i.id, i.invoice_number, i.status, i.issue_date, i.due_date,
  i.total, i.amount_paid, i.balance_due, i.currency, i.payment_terms,
  i.order_id, o.order_number, o.status AS order_status,
  (i.status IN ('Sent', 'Overdue') AND i.balance_due > 0) AS payable`

const PORTAL_INVOICE_FROM = `
  FROM invoices i
  LEFT JOIN orders o ON o.id = i.order_id
 WHERE i.status <> 'Draft'
   AND COALESCE(i.customer_id, o.customer_id) = $1`

async function getInvoices(customerId) {
  const { rows } = await db.query(
    `SELECT ${PORTAL_INVOICE_COLUMNS} ${PORTAL_INVOICE_FROM}
     ORDER BY (i.status IN ('Sent', 'Overdue') AND i.balance_due > 0) DESC,
              i.issue_date DESC NULLS LAST, i.invoice_number DESC`,
    [customerId]
  )
  return rows.map(shapeInvoice)
}

async function getInvoice(customerId, invoiceId) {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId ?? '')) return null

  const { rows } = await db.query(
    `SELECT ${PORTAL_INVOICE_COLUMNS},
            i.subtotal, i.discount_amt, i.tax_amt, i.rush_services, i.shipping_charges,
            i.customer_name, i.billing_email, i.contact_number,
            i.billing_address, i.shipping_address, i.notes,
            o.order_date, o.due_date AS order_due_date, o.order_type,
            o.payment_status AS order_payment_status,
            o.shipping_name, o.tracking_number, o.courier
     ${PORTAL_INVOICE_FROM} AND i.id = $2 LIMIT 1`,
    [customerId, invoiceId]
  )
  const inv = rows[0]
  if (!inv) return null

  const { rows: items } = await db.query(
    `SELECT id, description, qty, unit_price, amount, sizes, colors
       FROM invoice_items WHERE invoice_id = $1
      ORDER BY sort_order, created_at`,
    [invoiceId]
  )

  return {
    ...shapeInvoice(inv),
    subtotal: num(inv.subtotal),
    discount: num(inv.discount_amt),
    tax: num(inv.tax_amt),
    rush: num(inv.rush_services),
    shipping: num(inv.shipping_charges),
    billTo: {
      name: inv.customer_name,
      email: inv.billing_email,
      phone: inv.contact_number,
      address: inv.billing_address,
    },
    shipTo: inv.shipping_address,
    notes: inv.notes,
    order: inv.order_id ? {
      id: inv.order_id,
      number: inv.order_number,
      date: inv.order_date,
      dueDate: inv.order_due_date,
      type: inv.order_type,
      status: inv.order_status,
      paymentStatus: inv.order_payment_status,
      shippingName: inv.shipping_name,
      trackingNumber: inv.tracking_number,
      courier: inv.courier,
    } : null,
    items: items.map(it => ({
      id: it.id,
      description: it.description,
      qty: num(it.qty),
      unitPrice: num(it.unit_price),
      amount: num(it.amount),
      sizes: it.sizes,
      colors: it.colors,
    })),
  }
}

const num = v => (v === null || v === undefined ? 0 : Number(v))

function shapeInvoice(r) {
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    status: r.status,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    total: num(r.total),
    amountPaid: num(r.amount_paid),
    balanceDue: num(r.balance_due),
    currency: r.currency || 'USD',
    paymentTerms: r.payment_terms,
    orderId: r.order_id,
    orderNumber: r.order_number,
    orderStatus: r.order_status,
    payable: Boolean(r.payable),
  }
}

module.exports = {
  login, changePassword, getSummary, getOrders, getArtworks, getAssetPath, getProfile,
  getInvoices, getInvoice,
}
