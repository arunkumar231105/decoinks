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
  const { rows: artRows } = await db.query(
    `SELECT COUNT(*)::int AS artworks,
            COUNT(*) FILTER (
              WHERE status IN ('Approved','Production Ready','Sent to Customer')
                 OR asset_type IN ('gangsheet','artwork','sent')
            )::int AS used
       FROM artwork_vault_assets
      WHERE customer_id = $1 AND mime_type LIKE 'image/%'`,
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
  const art = { rows: [{ artworks: artRows[0].artworks, transfers_qty: qtyRows[0].transfers_qty, used: artRows[0].used }] }

  const s = rows[0]
  return {
    orders: s.orders,
    orderValue: Number(s.order_value),
    inProduction: s.in_production,
    shipped: s.shipped,
    delivered: s.delivered,
    artworks: art.rows[0].artworks,
    transfersQty: art.rows[0].transfers_qty,
    artworksUsedInOrders: art.rows[0].used,
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
         SELECT ship_date, tracking_number, carrier FROM shipments
          WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
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
 * Artwork the customer can see, straight from the Nextcloud vault mirror.
 *
 * `artwork_vault_assets` is the synced view of Nextcloud, so this is the same
 * source the admin Artwork Vault reads. Assets carry no order_id in the data
 * today, so "used in production" is derived from the asset's own lifecycle —
 * a gangsheet, or an asset that reached Approved / Production Ready / Sent to
 * Customer, has been worked on; anything still at Source Received / In Design
 * has not. This is stated in the API rather than invented per order.
 */
const USED_STATUSES = ['Approved', 'Production Ready', 'Sent to Customer']
const USED_TYPES = ['gangsheet', 'artwork', 'sent']

async function getArtworks(customerId) {
  const { rows } = await db.query(
    `SELECT id, file_name, path, mime_type, file_size_bytes, asset_type, status,
            version_no, artwork_code, asset_number, created_at, source_modified_at
       FROM artwork_vault_assets
      WHERE customer_id = $1
        AND mime_type LIKE 'image/%'
      ORDER BY COALESCE(source_modified_at, created_at) DESC`,
    [customerId]
  )

  const kb = n => (n == null ? null : n < 1024 * 1024
    ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`)

  return rows.map(r => {
    const used = USED_STATUSES.includes(r.status) || USED_TYPES.includes(r.asset_type)
    return {
      id: r.id,
      artworkId: r.artwork_code || r.asset_number || null,
      name: r.file_name.replace(/\.[^.]+$/, ''),
      fileName: r.file_name,
      previewUrl: `/api/portal/artworks/${r.id}/preview`,
      downloadUrl: `/api/portal/artworks/${r.id}/file`,
      size: null,
      transfersQty: 0,
      fileType: (r.mime_type || '').split('/')[1]?.toUpperCase() || null,
      fileSize: kb(Number(r.file_size_bytes)),
      dateAdded: D(r.source_modified_at || r.created_at),
      timeAdded: null,
      createdBy: null,
      stage: r.status,
      assetType: r.asset_type,
      version: r.version_no,
      used,
      usedInOrders: [],
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

module.exports = { login, changePassword, getSummary, getOrders, getArtworks, getAssetPath, getProfile }
