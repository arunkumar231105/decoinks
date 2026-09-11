const db     = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { validateTransition } = require('../../utils/stateMachine');

// ── Auth ──────────────────────────────────────────────────────────────────────

async function loginSupplier(username, password) {
  const loginId = String(username ?? '').trim().toLowerCase();
  const { rows } = await db.query(
    `SELECT spu.*, s.name AS company_name, s.email AS company_email,
            s.phone, s.address_line1, s.city, s.state, s.country
     FROM supplier_portal_users spu
     JOIN suppliers s ON s.id = spu.supplier_id
     WHERE LOWER(spu.username) = $1 OR LOWER(s.email) = $1`,
    [loginId]
  );
  if (!rows[0]) throw new Error('Invalid credentials');
  const user = rows[0];
  if (!user.is_active) throw new Error('Account is disabled. Contact your administrator.');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Invalid credentials');

  await db.query('UPDATE supplier_portal_users SET last_login = NOW() WHERE id = $1', [user.id]);

  const token = jwt.sign(
    {
      supplierId:   user.supplier_id,
      portalUserId: user.id,
      username:     user.username,
      role:         'supplier',
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_SUPPLIER_EXPIRY || '7d' }
  );

  return {
    token,
    mustChangePw: user.must_change_pw,
    supplier: {
      id:    user.supplier_id,
      name:  user.company_name,
      email: user.company_email,
    },
  };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function getDashboard(supplierId) {
  const [statusRes, trendRes, recentRes, typeRes, prevWeekRes, thisWeekRes] = await Promise.all([
    db.query(
      `SELECT o.status, COUNT(*) AS count
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
       GROUP BY o.status`,
      [supplierId]
    ),
    db.query(
      `SELECT DATE(o.order_date) AS date, COUNT(*) AS orders
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
         AND o.order_date >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(o.order_date)
       ORDER BY date`,
      [supplierId]
    ),
    db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.order_date, o.due_date
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
       ORDER BY o.order_date DESC LIMIT 5`,
      [supplierId]
    ),
    db.query(
      `SELECT o.order_type, COUNT(*) AS count
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
       GROUP BY o.order_type`,
      [supplierId]
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
         AND o.order_date >= NOW() - INTERVAL '14 days'
         AND o.order_date <  NOW() - INTERVAL '7 days'`,
      [supplierId]
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
         AND o.order_date >= NOW() - INTERVAL '7 days'`,
      [supplierId]
    ),
  ]);

  const counts = {};
  for (const row of statusRes.rows) counts[row.status] = parseInt(row.count);

  const thisWeek = parseInt(thisWeekRes.rows[0]?.count ?? 0);
  const prevWeek = parseInt(prevWeekRes.rows[0]?.count ?? 0);
  const weekDelta = thisWeek - prevWeek;

  const TYPE_COLORS = { apparel: '#3B82F6', gangsheet: '#8B5CF6', dtf: '#EA580C' };
  const STATUS_COLORS = {
    Draft:           '#94A3B8',
    Confirmed:       '#0EA5E9',
    'In Production': '#3B82F6',
    QC:              '#8B5CF6',
    'Ready to Ship': '#F59E0B',
    Shipped:         '#EA580C',
    Delivered:       '#16A34A',
    Cancelled:       '#DC2626',
  };

  const totalOrders = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    totalOrders,
    inProduction: counts['In Production'] ?? 0,
    shipped:      counts['Shipped'] ?? 0,
    completed:    counts['Completed'] ?? 0,
    weekDelta,
    ordersByStatus: statusRes.rows.map((r) => ({
      name:  r.status,
      value: parseInt(r.count),
      color: STATUS_COLORS[r.status] ?? '#94A3B8',
    })),
    ordersByType: typeRes.rows.map((r) => ({
      name:  r.order_type,
      value: parseInt(r.count),
      color: TYPE_COLORS[r.order_type] ?? '#94A3B8',
    })),
    trendData:    trendRes.rows.map((r) => ({ date: r.date, orders: parseInt(r.orders) })),
    recentOrders: recentRes.rows,
    // Same vocabulary as the state machine — a snapshot built from statuses an
    // order never holds reads as four zeroes next to a non-zero order count.
    productionSnapshot: [
      { label: 'Awaiting Production', count: (counts['Draft'] ?? 0) + (counts['Confirmed'] ?? 0), color: '#EAB308' },
      { label: 'In Production',       count: (counts['In Production'] ?? 0) + (counts['QC'] ?? 0), color: '#3B82F6' },
      { label: 'Shipped',             count: (counts['Ready to Ship'] ?? 0) + (counts['Shipped'] ?? 0), color: '#EA580C' },
      { label: 'Delivered',           count: counts['Delivered'] ?? 0, color: '#16A34A' },
    ].map((s) => ({ ...s, pct: totalOrders > 0 ? Math.round((s.count / totalOrders) * 100) : 0 })),
  };
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function getSupplierOrders(supplierId, { page = 1, limit = 10, status, search, order_type, date_from, date_to } = {}) {
  const offset     = (page - 1) * limit;
  const conditions = ['pov.supplier_id = $1', 'pov.is_visible = TRUE'];
  const params     = [supplierId];

  if (status)     { params.push(status);            conditions.push(`o.status = $${params.length}`); }
  if (order_type) { params.push(order_type);         conditions.push(`o.order_type = $${params.length}`); }
  if (search)     { params.push(`%${search}%`);      conditions.push(`o.order_number ILIKE $${params.length}`); }
  if (date_from)  { params.push(date_from);          conditions.push(`o.order_date >= $${params.length}`); }
  if (date_to)    { params.push(date_to);            conditions.push(`o.order_date <= $${params.length}::date + INTERVAL '1 day'`); }

  const where = conditions.join(' AND ');
  const baseConditions = ['pov.supplier_id = $1', 'pov.is_visible = TRUE'];

  const [dataRes, countRes, aggRes] = await Promise.all([
    db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type,
              o.order_date, o.due_date, o.total, o.payment_status,
              pov.sent_at,
              pu.po_number
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       LEFT JOIN purchase_orders pu ON pu.order_id = o.id
       WHERE ${where}
       ORDER BY o.order_date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.query(
      `SELECT COUNT(*) FROM portal_order_visibility pov JOIN orders o ON o.id = pov.order_id WHERE ${where}`,
      params
    ),
    // The order state machine runs Draft → Confirmed → In Production → QC →
    // Ready to Ship → Shipped → Delivered (or Cancelled). 'Completed' and
    // 'On Hold' are not statuses an order can hold, so count the ones it can.
    db.query(
      `SELECT
         COUNT(*)                                               AS total,
         COUNT(*) FILTER (WHERE o.order_type = 'gangsheet')    AS gangsheet,
         COUNT(*) FILTER (WHERE o.order_type = 'apparel')      AS apparel,
         COUNT(*) FILTER (WHERE o.order_type = 'dtf')          AS dtf,
         COUNT(*) FILTER (WHERE o.status = 'Cancelled')        AS cancelled,
         COUNT(*) FILTER (WHERE o.status = 'In Production')    AS in_production,
         COUNT(*) FILTER (WHERE o.status = 'Shipped')          AS shipped,
         COUNT(*) FILTER (WHERE o.status = 'Delivered')        AS delivered
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       WHERE ${baseConditions.join(' AND ')}`,
      [supplierId]
    ),
  ]);

  const agg = aggRes.rows[0];
  return {
    orders: dataRes.rows,
    total:  parseInt(countRes.rows[0].count),
    counts: {
      total:        parseInt(agg.total),
      gangsheet:    parseInt(agg.gangsheet),
      apparel:      parseInt(agg.apparel),
      dtf:          parseInt(agg.dtf),
      cancelled:    parseInt(agg.cancelled),
      inProduction: parseInt(agg.in_production),
      shipped:      parseInt(agg.shipped),
      delivered:    parseInt(agg.delivered),
    },
  };
}

async function getSupplierOrderDetail(supplierId, orderId) {
  const { rows: anyVis } = await db.query(
    `SELECT supplier_id FROM portal_order_visibility WHERE order_id = $1 AND is_visible = TRUE`,
    [orderId]
  );
  if (!anyVis.length) return null;

  const belongsToSupplier = anyVis.some((r) => r.supplier_id === supplierId);
  if (!belongsToSupplier) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  const { rows: orderRows } = await db.query(
    `SELECT o.*, s.name AS supplier_name, pu.po_number AS purchase_order_number
     FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     LEFT JOIN purchase_orders pu ON pu.order_id = o.id
     WHERE o.id = $1`,
    [orderId]
  );
  if (!orderRows.length) return null;

  const order = orderRows[0];

  let items = [];
  if (order.order_type === 'apparel') {
    const { rows } = await db.query('SELECT * FROM order_items_apparel WHERE order_id = $1', [orderId]);
    items = rows;
  } else if (order.order_type === 'gangsheet') {
    const { rows } = await db.query('SELECT * FROM order_items_gangsheet WHERE order_id = $1', [orderId]);
    items = rows;
  } else if (order.order_type === 'dtf') {
    const { rows } = await db.query('SELECT * FROM order_items_dtf WHERE order_id = $1', [orderId]);
    items = rows;
  }

  const { rows: artworks } = await db.query(
    `SELECT a.id, a.artwork_no, a.name, a.file_url, a.thumbnail_url
     FROM artworks a
     WHERE a.order_id = $1`,
    [orderId]
  );

  return { ...order, items, artworks };
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function getSupplierPODetail(supplierId, poId) {
  const { rows: vis } = await db.query(
    `SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [poId, supplierId]
  );
  if (!vis.length) return null;

  const { rows: poRows } = await db.query(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1`,
    [poId]
  );
  if (!poRows.length) return null;

  const { rows: items } = await db.query(
    `SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY sort_order, created_at`,
    [poId]
  );

  return { ...poRows[0], items };
}

async function getSupplierPOs(supplierId, { page = 1, limit = 10, search } = {}) {
  const offset     = (page - 1) * limit;
  const conditions = ['ppv.supplier_id = $1', 'ppv.is_visible = TRUE'];
  const params     = [supplierId];

  if (search) { params.push(`%${search}%`); conditions.push(`po.po_number ILIKE $${params.length}`); }
  const where = conditions.join(' AND ');

  const [dataRes, countRes] = await Promise.all([
    db.query(
      `SELECT po.id, po.po_number, po.status, po.created_at AS issue_date, po.expected_date, po.grand_total AS total
       FROM portal_po_visibility ppv
       JOIN purchase_orders po ON po.id = ppv.po_id
       WHERE ${where}
       ORDER BY po.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.query(
      `SELECT COUNT(*) FROM portal_po_visibility ppv JOIN purchase_orders po ON po.id = ppv.po_id WHERE ${where}`,
      params
    ),
  ]);

  return { purchaseOrders: dataRes.rows, total: parseInt(countRes.rows[0].count) };
}

// ── Artworks ──────────────────────────────────────────────────────────────────

async function getSupplierArtworks(supplierId) {
  const { rows } = await db.query(
    `SELECT DISTINCT a.id, a.artwork_no, a.name, a.file_url, a.thumbnail_url, a.created_at
     FROM artworks a
     JOIN orders o ON o.id = a.order_id
     JOIN portal_order_visibility pov ON pov.order_id = o.id
     WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE
     ORDER BY a.created_at DESC`,
    [supplierId]
  );
  return rows;
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function getNotifications(supplierId) {
  const { rows } = await db.query(
    `SELECT * FROM portal_notifications WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [supplierId]
  );
  return rows;
}

async function markNotificationRead(supplierId, notifId) {
  await db.query(
    `UPDATE portal_notifications SET is_read = TRUE WHERE id = $1 AND supplier_id = $2`,
    [notifId, supplierId]
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

async function getProfile(supplierId) {
  const { rows } = await db.query(
    `SELECT s.name, s.email, s.phone, s.address_line1, s.city, s.state, s.country
     FROM suppliers s WHERE s.id = $1`,
    [supplierId]
  );
  return rows[0] ?? null;
}

async function changePassword(portalUserId, currentPassword, newPassword) {
  const { rows } = await db.query('SELECT password_hash FROM supplier_portal_users WHERE id = $1', [portalUserId]);
  if (!rows[0]) throw new Error('User not found');
  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!ok) throw new Error('Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, 12);
  await db.query(
    'UPDATE supplier_portal_users SET password_hash = $1, must_change_pw = FALSE, updated_at = NOW() WHERE id = $2',
    [hash, portalUserId]
  );
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

async function sendOrderToPortal(orderId, sentByUserId) {
  const { rows } = await db.query(
    'SELECT supplier_id, order_number FROM orders WHERE id = $1',
    [orderId]
  );
  if (!rows[0]) throw new Error('Order not found');
  const { supplier_id, order_number } = rows[0];
  if (!supplier_id) throw new Error('Order has no linked supplier');

  await db.query(
    `INSERT INTO portal_order_visibility (order_id, supplier_id, sent_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id, supplier_id) DO UPDATE SET is_visible = TRUE, sent_at = NOW()`,
    [orderId, supplier_id, sentByUserId]
  );

  await db.query(
    `INSERT INTO portal_notifications (supplier_id, type, title, message, reference_id)
     VALUES ($1, 'new_order', 'New Order Available', $2, $3)`,
    [supplier_id, `Order ${order_number} is now available in your portal`, orderId]
  );

  return { success: true };
}

// ── PO Status Update (supplier-initiated) ────────────────────────────────────

async function updatePOStatus(supplierId, poId, status) {
  // Confirm this PO is visible to this supplier
  const { rows: vis } = await db.query(
    `SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [poId, supplierId]
  );
  if (!vis.length) {
    const err = new Error('Purchase order not found or access denied');
    err.status = 403;
    throw err;
  }

  // Fetch current status
  const { rows: cur } = await db.query(
    `SELECT status FROM purchase_orders WHERE id = $1`,
    [poId]
  );
  if (!cur[0]) {
    const err = new Error('Purchase order not found');
    err.status = 404;
    throw err;
  }

  // Validate via state machine — supplier role
  validateTransition('po', cur[0].status, status, { id: supplierId, role: 'supplier' });

  const { rows } = await db.query(
    `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
    [status, poId]
  );

  // Record in history
  await db.query(
    `INSERT INTO po_status_history (po_id, from_status, to_status, comment)
     VALUES ($1, $2, $3, 'Updated by supplier via portal')`,
    [poId, cur[0].status, status]
  ).catch(() => {});  // history is best-effort

  return rows[0];
}

// ── PO Tracking Upload ────────────────────────────────────────────────────────

async function addTracking(supplierId, poId, { tracking_number, carrier, tracking_notes }) {
  const { rows: vis } = await db.query(
    `SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [poId, supplierId]
  );
  if (!vis.length) {
    const err = new Error('Purchase order not found or access denied');
    err.status = 403;
    throw err;
  }

  const { rows } = await db.query(
    `UPDATE purchase_orders
     SET tracking_number = $1, carrier = $2, tracking_notes = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING id, po_number, order_id, tracking_number, carrier, tracking_notes`,
    [tracking_number || null, carrier || null, tracking_notes || null, poId]
  );
  await recordSupplierParcel(rows[0]);
  return rows[0];
}

/**
 * A tracking number the factory hands in becomes a parcel the shop can see.
 *
 * Until now this landed on the purchase order and stopped there, so a job the
 * factory had already sent showed no shipment at all: nothing in the Shipments
 * list, no courier status, no delivery estimate, and the ten-minute tracking
 * sync never looked at it because it only follows shipment rows.
 *
 * It is attached to the PO's sales order rather than to the PO itself. The
 * factories here print and post straight to the customer — of the 110 purchase
 * orders carrying a tracking number, 107 carry the very number the customer's
 * own parcel has — so this is the customer's parcel, arriving through the
 * factory's hands. chk_shipments_target_xor would in any case refuse a row that
 * named both.
 *
 * Idempotent, and quiet about it: a tracking number already on file is left
 * alone, and one sitting loose is joined to the order rather than copied.
 * Failure here never fails the upload — the factory has done its part, and the
 * tracking is safely on the purchase order either way.
 */
async function recordSupplierParcel(po) {
  const tracking = String(po?.tracking_number ?? '').trim();
  if (!tracking || !po?.order_id) return;

  try {
    const { rows: seen } = await db.query(
      `SELECT id, order_id FROM shipments WHERE tracking_number = $1 AND deleted_at IS NULL LIMIT 1`,
      [tracking]
    );
    if (seen[0]) {
      if (!seen[0].order_id) {
        await db.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW() WHERE id = $1`,
          [seen[0].id, po.order_id]
        );
      }
      return;
    }

    const { rows: ord } = await db.query(
      `SELECT o.id, o.shipping_address, o.shipping_name,
              COALESCE(c.name, o.contact_name) AS customer_name,
              c.city, c.state, c.zip
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [po.order_id]
    );
    if (!ord[0]) return;
    const o = ord[0];

    const { rows: n } = await db.query(
      `SELECT COALESCE(MAX(NULLIF(split_part(shipment_number, '-', 3), '')::INT), 0) + 1 AS n
         FROM shipments WHERE shipment_number LIKE 'SHP-2026-%'`
    );
    const number = `SHP-2026-${String(n[0].n).padStart(4, '0')}`;

    await db.query(
      `INSERT INTO shipments (shipment_number, order_id, recipient_name, customer_name,
                              carrier, tracking_number, status, ship_date, address,
                              ship_to_city, ship_to_state, ship_to_postal_code,
                              ship_source, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$4,$5,'Label Created'::shipment_status,CURRENT_DATE,$6,$7,$8,$9,
               'Supplier', $10, NOW(), NOW())`,
      [number, o.id, o.customer_name ?? o.shipping_name ?? null, po.carrier || null, tracking,
       o.shipping_address ?? null, o.city ?? null, o.state ?? null, o.zip ?? null,
       `Handed in by the factory on ${po.po_number}. The courier's own status follows on the next tracking sync.`]
    );
  } catch (err) {
    // The upload has already succeeded and the number is on the purchase order.
    // Losing the shipment row is worth a log, not a failed upload the factory
    // would have to repeat.
    console.error('[portal] could not record the factory parcel as a shipment:', err.message);
  }
}

// ── Status Updates ────────────────────────────────────────────────────────────

async function submitStatusUpdate(supplierId, orderId, { status, notes }) {
  const { rows: vis } = await db.query(
    `SELECT 1 FROM portal_order_visibility WHERE order_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [orderId, supplierId]
  );
  if (!vis.length) {
    const err = new Error('Order not found or access denied');
    err.status = 403;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO portal_status_updates (order_id, supplier_id, status, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [orderId, supplierId, status, notes || null]
  );
  return rows[0];
}

async function getStatusUpdates(supplierId, orderId) {
  const { rows } = await db.query(
    `SELECT psu.*, s.name AS supplier_name
     FROM portal_status_updates psu
     JOIN suppliers s ON s.id = psu.supplier_id
     WHERE psu.order_id = $1 AND psu.supplier_id = $2
     ORDER BY psu.submitted_at DESC`,
    [orderId, supplierId]
  );
  return rows;
}

/**
 * Every supplier update on one order, for staff.
 *
 * getStatusUpdates is deliberately scoped to the supplier that wrote the rows —
 * a vendor may only read its own. Staff need the whole thread on the order,
 * including which supplier sent each line, so this is a separate reader rather
 * than a widened one.
 */
async function getOrderStatusUpdatesForStaff(orderId) {
  const { rows } = await db.query(
    `SELECT psu.id, psu.status, psu.notes, psu.submitted_at,
            psu.supplier_id, s.name AS supplier_name
     FROM portal_status_updates psu
     JOIN suppliers s ON s.id = psu.supplier_id
     WHERE psu.order_id = $1
     ORDER BY psu.submitted_at DESC`,
    [orderId]
  );
  return rows;
}

module.exports = {
  loginSupplier,
  getDashboard,
  getSupplierOrders,
  getSupplierOrderDetail,
  getSupplierPOs,
  getSupplierPODetail,
  getSupplierArtworks,
  getNotifications,
  markNotificationRead,
  getProfile,
  changePassword,
  sendOrderToPortal,
  submitStatusUpdate,
  getStatusUpdates,
  getOrderStatusUpdatesForStaff,
  updatePOStatus,
  addTracking,
};
