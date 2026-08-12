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
  const art = await db.query(
    `SELECT COUNT(*)::int AS artworks,
            COALESCE(SUM(a.transfers_qty), 0)::int AS transfers_qty
       FROM artworks a WHERE a.customer_id = $1`,
    [customerId]
  ).catch(() => ({ rows: [{ artworks: 0, transfers_qty: 0 }] }))

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
            s.ship_date, s.tracking_number AS shipment_tracking, s.carrier
       FROM orders o
       LEFT JOIN invoices   i ON i.order_id = o.id
       LEFT JOIN quotations q ON q.id = o.quotation_id
       LEFT JOIN LATERAL (
         SELECT ship_date, tracking_number, carrier FROM shipments
          WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) s ON TRUE
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
    artworkCount: 0,
    transfersQty: 0,
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

async function getArtworks(customerId) {
  const { rows } = await db.query(
    `SELECT a.id, a.artwork_no, a.name, a.file_url, a.width_in, a.height_in, a.created_at
       FROM artworks a WHERE a.customer_id = $1 ORDER BY a.created_at DESC`,
    [customerId]
  ).catch(() => ({ rows: [] }))

  return rows.map(r => ({
    id: r.id,
    artworkId: r.artwork_no,
    name: r.name || r.artwork_no,
    fileName: r.name,
    previewUrl: r.file_url,
    downloadUrl: r.file_url,
    size: r.width_in && r.height_in ? `${r.width_in}" × ${r.height_in}"` : null,
    transfersQty: 0,
    fileType: null,
    fileSize: null,
    dateAdded: D(r.created_at),
    timeAdded: null,
    createdBy: null,
    usedInOrders: [],
  }))
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

module.exports = { login, changePassword, getSummary, getOrders, getArtworks, getProfile }
