const db     = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { validateTransition } = require('../../utils/stateMachine');

// Money columns arrive from pg as strings; the portal formats numbers.
const money = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ── Shared pieces ─────────────────────────────────────────────────────────────

// This supplier's purchase orders on one sales order. An order can carry more
// than one PO (and a PO can cover several orders through po_orders), so they
// are aggregated rather than joined — a join repeated the order once per PO.
const SUPPLIER_POS_FOR_ORDER = `
  LEFT JOIN LATERAL (
    SELECT string_agg(p.po_number, ', ' ORDER BY p.po_number) AS po_number,
           SUM(COALESCE(p.grand_total, p.total))              AS po_total
      FROM purchase_orders p
     WHERE p.deleted_at IS NULL AND p.supplier_id = pov.supplier_id
       AND (p.order_id = o.id
            OR EXISTS (SELECT 1 FROM po_orders poo WHERE poo.po_id = p.id AND poo.order_id = o.id))
  ) pos ON TRUE`;

// Pieces and sizes across whichever line table the order uses.
const ORDER_QTY = `
  LEFT JOIN LATERAL (
    SELECT SUM(it.q)::int AS total_qty,
           string_agg(DISTINCT it.sz, ', ') FILTER (WHERE it.sz IS NOT NULL AND it.sz <> '') AS size_summary
      FROM (SELECT qty AS q, size AS sz FROM order_items_apparel   WHERE order_id = o.id
            UNION ALL SELECT qty, size FROM order_items_dtf       WHERE order_id = o.id
            UNION ALL SELECT qty, size FROM order_items_gangsheet WHERE order_id = o.id) it
  ) q ON TRUE`;

const ORDER_SHIPPED = `
  LEFT JOIN LATERAL (
    SELECT MIN(sh.ship_date) AS ship_date, MAX(sh.delivered_date) AS delivered_date
      FROM shipments sh WHERE sh.order_id = o.id AND sh.deleted_at IS NULL
  ) shp ON TRUE`;

// The parcels a PO went out in: the one it was handed in on (from_po_id, po_id
// on older rows), else the parcels of the order it covers.
async function shipmentsFor({ poId = null, orderIds = [] }) {
  const { rows } = await db.query(
    `SELECT sh.id, sh.shipment_number, sh.carrier, sh.tracking_number,
            sh.status::text AS status, sh.ship_date, sh.estimated_delivery, sh.delivered_date
       FROM shipments sh
      WHERE sh.deleted_at IS NULL
        AND (($1::uuid IS NOT NULL AND (sh.from_po_id = $1 OR sh.po_id = $1))
             OR sh.order_id = ANY($2::uuid[]))
      ORDER BY sh.ship_date DESC NULLS LAST, sh.created_at DESC`,
    [poId, orderIds]
  );
  return rows;
}

/**
 * Artwork a supplier needs to print, for a set of orders.
 *
 * The artworks table only holds files uploaded through the Artwork screen; most
 * jobs carry their print images on the order lines instead (front/back images
 * and mockups, DTF artwork, gangsheet artwork lists). Both are returned in one
 * shape, de-duplicated by image, so the portal shows every design it will print.
 */
async function artworksForOrders(orderIds, supplierId = null) {
  if (!orderIds.length) return [];
  const [files, apparel, dtf, gangsheet] = await Promise.all([
    db.query(
      `SELECT a.id::text, a.artwork_no AS artwork_number, a.name, a.file_url, a.thumbnail_url,
              a.location_on_product AS position, a.width_inches AS width, a.height_inches AS height,
              a.order_id::text, o.order_number, a.created_at
         FROM artworks a JOIN orders o ON o.id = a.order_id
        WHERE a.order_id = ANY($1::uuid[])`,
      [orderIds]
    ),
    db.query(
      `SELECT i.id::text, i.item, i.color, i.artwork_no, i.artwork_size,
              COALESCE(i.front_mockup, i.front_image) AS front, COALESCE(i.back_mockup, i.back_image) AS back,
              o.id::text AS order_id, o.order_number, o.order_date
         FROM order_items_apparel i JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = ANY($1::uuid[])
          AND COALESCE(i.front_mockup, i.front_image, i.back_mockup, i.back_image) IS NOT NULL`,
      [orderIds]
    ),
    db.query(
      `SELECT i.id::text, i.artwork_name, i.artwork_no, i.width_inches, i.height_inches,
              COALESCE(i.artwork_image, i.front_image) AS front, i.back_image AS back,
              o.id::text AS order_id, o.order_number, o.order_date
         FROM order_items_dtf i JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = ANY($1::uuid[])
          AND COALESCE(i.artwork_image, i.front_image, i.back_image) IS NOT NULL`,
      [orderIds]
    ),
    db.query(
      `SELECT g.id::text, g.size, g.front_image,
              CASE WHEN jsonb_typeof(g.artworks) = 'array' THEN g.artworks ELSE '[]'::jsonb END AS artworks,
              o.id::text AS order_id, o.order_number, o.order_date
         FROM order_items_gangsheet g JOIN orders o ON o.id = g.order_id
        WHERE g.order_id = ANY($1::uuid[])`,
      [orderIds]
    ),
  ]);

  const out = files.rows.map((a) => ({ ...a, width: money(a.width), height: money(a.height), source: 'artwork' }));
  const add = (row) => { if (row.file_url) out.push({ thumbnail_url: row.file_url, width: null, height: null, ...row }); };

  for (const i of apparel.rows) {
    const base = { artwork_number: i.artwork_no, order_id: i.order_id, order_number: i.order_number,
                   created_at: i.order_date, size: i.artwork_size, source: 'order_line' };
    add({ ...base, id: `${i.id}-front`, name: `${i.item ?? 'Garment'}${i.color ? ` · ${i.color}` : ''} (front)`, file_url: i.front, position: 'Front' });
    add({ ...base, id: `${i.id}-back`,  name: `${i.item ?? 'Garment'}${i.color ? ` · ${i.color}` : ''} (back)`,  file_url: i.back,  position: 'Back' });
  }
  for (const i of dtf.rows) {
    const base = { artwork_number: i.artwork_no, order_id: i.order_id, order_number: i.order_number,
                   created_at: i.order_date, width: money(i.width_inches), height: money(i.height_inches), source: 'order_line' };
    add({ ...base, id: `${i.id}-front`, name: i.artwork_name ?? 'DTF artwork', file_url: i.front, position: 'Front' });
    add({ ...base, id: `${i.id}-back`,  name: `${i.artwork_name ?? 'DTF artwork'} (back)`, file_url: i.back, position: 'Back' });
  }
  for (const g of gangsheet.rows) {
    const list = Array.isArray(g.artworks) ? g.artworks : [];
    list.forEach((a, n) => add({
      id: `${g.id}-${n}`, artwork_number: a?.artwork_no || null, name: a?.name || a?.artwork_no || 'Gangsheet artwork',
      file_url: a?.image || null, position: 'Gangsheet', size: a?.size || g.size,
      order_id: g.order_id, order_number: g.order_number, created_at: g.order_date, source: 'order_line',
    }));
    if (!list.length) add({
      id: `${g.id}-sheet`, artwork_number: null, name: `Gangsheet ${g.size ?? ''}`.trim(), file_url: g.front_image,
      position: 'Gangsheet', size: g.size, order_id: g.order_id, order_number: g.order_number,
      created_at: g.order_date, source: 'order_line',
    });
  }

  const seen = new Set();
  const own = out
    .filter((a) => (a.file_url && !seen.has(a.file_url) ? seen.add(a.file_url) : false))
    .sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));

  // The vault is a second store on another server; if it cannot be read the
  // order still loads with whatever the order itself carries.
  const vault = supplierId
    ? await vaultArtworksForOrders(orderIds, supplierId).catch((err) => {
        console.error('[portal] vault artwork lookup failed:', err.message);
        return [];
      })
    : [];
  return [...own, ...vault];
}

const VAULT_ROLE = {
  FNLA: 'Approved final', FNL: 'Final', OUT: 'Print file', MOCK: 'Mockup', MU: 'Mockup',
  GS: 'Gangsheet', WRK: 'Working file', SRC: 'Customer source', REF: 'Reference',
};

/**
 * Artwork kept in the Printshop vault (Nextcloud), matched to orders.
 *
 * Most jobs never write an image onto their order lines: the files live in the
 * customer's vault folder (Leads 2.0/<date>_<Customer>/{references,Artworks,sent}),
 * named AW-<CLIENT>-<NNNN>-<TYPE>. Every file carries the customer, none carries
 * the order, so the match is made the way the shop itself works:
 *   - a customer with one order: all of that customer's designs belong to it;
 *   - a customer with several: a design belongs to the order whose date window
 *     (after the previous order, before the next) its file was last touched in.
 * A design appears once, as its most finished version: approved final, final,
 * print file, mockup, working file, then the customer's source.
 */
async function vaultArtworksForOrders(orderIds, supplierId) {
  if (!orderIds.length) return [];
  const { rows } = await db.query(
    `WITH cust_orders AS (
       SELECT o.id, o.order_number, o.order_date, o.customer_id,
              lag(o.order_date)  OVER w AS prev_date,
              lead(o.order_date) OVER w AS next_date,
              count(*)           OVER (PARTITION BY o.customer_id) AS orders_for_customer
         FROM orders o
        WHERE o.deleted_at IS NULL AND o.order_date IS NOT NULL
          AND o.customer_id IN (SELECT customer_id FROM orders WHERE id = ANY($1::uuid[]))
       WINDOW w AS (PARTITION BY o.customer_id ORDER BY o.order_date, o.order_number)
     ),
     wanted AS (
       SELECT co.* FROM cust_orders co
        WHERE co.id = ANY($1::uuid[])
          AND EXISTS (SELECT 1 FROM portal_order_visibility pov
                       WHERE pov.order_id = co.id AND pov.supplier_id = $2 AND pov.is_visible = TRUE)
     ),
     candidates AS (
       SELECT w.id AS order_id, w.order_number, w.orders_for_customer,
              v.id AS asset_id, v.file_name, v.artwork_code, upper(COALESCE(v.lifecycle_code, '')) AS lifecycle,
              v.file_size_bytes, v.source_modified_at, split_part(v.path, '/', 2) AS folder,
              row_number() OVER (
                PARTITION BY w.id, COALESCE(v.artwork_code, lower(v.file_name))
                ORDER BY CASE upper(COALESCE(v.lifecycle_code, ''))
                           WHEN 'FNLA' THEN 0 WHEN 'FNL' THEN 1 WHEN 'OUT' THEN 2 WHEN 'MOCK' THEN 3 WHEN 'MU' THEN 3
                           WHEN 'GS' THEN 4 WHEN 'WRK' THEN 5 WHEN 'SRC' THEN 6 WHEN 'REF' THEN 7 ELSE 8 END,
                         v.source_modified_at DESC NULLS LAST) AS rn
         FROM wanted w
         JOIN artwork_vault_assets v
           ON v.customer_id = w.customer_id AND v.mime_type LIKE 'image/%'
          AND COALESCE(lower(v.status), '') NOT IN ('deleted', 'trashed', 'trash')
          -- Nextcloud's small -THUMB copies are previews of a design, not a design.
          AND v.file_name !~* '-thumb[0-9]*\.[a-z0-9]+$'
        WHERE w.orders_for_customer = 1
           OR (v.source_modified_at::date >= COALESCE(w.prev_date + 1, w.order_date - 60)
               AND (w.next_date IS NULL OR v.source_modified_at::date < w.next_date))
     )
     SELECT * FROM candidates
      WHERE rn = 1
      ORDER BY order_number,
               CASE lifecycle WHEN 'FNLA' THEN 0 WHEN 'FNL' THEN 1 WHEN 'OUT' THEN 2 WHEN 'MOCK' THEN 3 WHEN 'MU' THEN 3
                              WHEN 'GS' THEN 4 WHEN 'WRK' THEN 5 WHEN 'SRC' THEN 6 WHEN 'REF' THEN 7 ELSE 8 END,
               artwork_code NULLS LAST, file_name`,
    [orderIds, supplierId]
  );
  return rows.map((r) => ({
    id: `vault-${r.order_id}-${r.asset_id}`,
    asset_id: r.asset_id,
    artwork_number: r.artwork_code,
    name: r.file_name,
    file_url: `/api/supplier/vault/${r.asset_id}/file`,
    thumbnail_url: `/api/supplier/vault/${r.asset_id}/preview`,
    position: VAULT_ROLE[r.lifecycle] ?? 'Artwork',
    lifecycle: r.lifecycle || null,
    width: null,
    height: null,
    order_id: r.order_id,
    order_number: r.order_number,
    created_at: r.source_modified_at,
    file_size: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
    folder: r.folder,
    source: 'vault',
    match: Number(r.orders_for_customer) === 1 ? 'customer' : 'customer_dates',
  }));
}

/** One vault file — only if its customer has an order shared with this supplier. */
async function getVaultAssetForSupplier(supplierId, assetId) {
  if (!UUID_RE.test(String(assetId || ''))) return null;
  const { rows } = await db.query(
    `SELECT v.path, v.file_name, v.mime_type
       FROM artwork_vault_assets v
      WHERE v.id = $1 AND v.mime_type LIKE 'image/%'
        AND EXISTS (SELECT 1 FROM portal_order_visibility pov
                      JOIN orders o ON o.id = pov.order_id
                     WHERE pov.supplier_id = $2 AND pov.is_visible = TRUE AND o.customer_id = v.customer_id)`,
    [assetId, supplierId]
  );
  return rows[0] || null;
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function getSupplierOrders(supplierId, { page = 1, limit = 10, status, search, order_type, date_from, date_to } = {}) {
  page  = Math.max(1, parseInt(page) || 1);
  limit = Math.min(500, Math.max(1, parseInt(limit) || 10));
  const offset     = (page - 1) * limit;
  const conditions = ['pov.supplier_id = $1', 'pov.is_visible = TRUE', 'o.deleted_at IS NULL'];
  const params     = [supplierId];

  if (status)     { params.push(status);            conditions.push(`o.status = $${params.length}`); }
  if (order_type) { params.push(order_type);         conditions.push(`o.order_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(o.order_number ILIKE $${params.length} OR o.shipping_name ILIKE $${params.length}
                      OR EXISTS (SELECT 1 FROM purchase_orders p
                                  WHERE p.deleted_at IS NULL AND p.supplier_id = pov.supplier_id
                                    AND p.order_id = o.id AND p.po_number ILIKE $${params.length}))`);
  }
  if (date_from)  { params.push(date_from);          conditions.push(`o.order_date >= $${params.length}`); }
  if (date_to)    { params.push(date_to);            conditions.push(`o.order_date < $${params.length}::date + INTERVAL '1 day'`); }

  const where = conditions.join(' AND ');
  const baseConditions = ['pov.supplier_id = $1', 'pov.is_visible = TRUE', 'o.deleted_at IS NULL'];

  const [dataRes, countRes, aggRes] = await Promise.all([
    db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type,
              o.order_date, o.due_date, pov.sent_at,
              pos.po_number, pos.po_total AS total,
              COALESCE(NULLIF(o.shipping_name, ''), c.name) AS customer_name,
              COALESCE(shp.ship_date, o.shipped_at::date) AS shipped_date,
              shp.delivered_date,
              q.total_qty, q.size_summary
       FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       ${SUPPLIER_POS_FOR_ORDER}
       ${ORDER_QTY}
       ${ORDER_SHIPPED}
       WHERE ${where}
       ORDER BY o.order_date DESC, o.order_number DESC
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
    orders: dataRes.rows.map((r) => ({ ...r, total: money(r.total) })),
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
  if (!UUID_RE.test(String(orderId || ''))) return null;
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

  // Everything the shop's own order page shows, except the customer's money —
  // totals, prices, payments, invoice and quote — and the shop's internal notes.
  const { rows: orderRows } = await db.query(
    `SELECT o.id, o.order_number, o.status, o.order_type, o.order_stage, o.process_status,
            o.order_date, o.entry_date, o.due_date, o.required_ship_date,
            o.shipping_name, o.shipping_address, o.contact_name, o.contact_email, o.contact_phone,
            o.shipping_method, o.courier, o.tracking_number, o.shipped_at,
            o.print_type, o.production_priority, o.production_method, o.production_facility,
            o.assigned_team, o.estimated_production_time, o.total_print_locations,
            o.production_notes, o.packing_instructions, o.shipping_instructions,
            o.production_notes AS notes,
            c.name AS customer_name, c.customer_number,
            c.address_line1 AS c_line1, c.city AS c_city, c.state AS c_state, c.zip AS c_zip, c.country AS c_country,
            ca.contact_person AS a_contact, ca.line1 AS a_line1, ca.line2 AS a_line2, ca.city AS a_city,
            ca.state AS a_state, ca.zipcode AS a_zip, ca.country AS a_country,
            s.name AS vendor_name, s.name AS supplier_name,
            pos.po_number, pos.po_number AS purchase_order_number,
            q.total_qty, q.size_summary
     FROM orders o
     JOIN portal_order_visibility pov ON pov.order_id = o.id AND pov.supplier_id = $2
     LEFT JOIN suppliers s ON s.id = pov.supplier_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT a.* FROM customer_addresses a
        WHERE a.id = o.shipping_address_id
           OR (o.shipping_address_id IS NULL AND a.customer_id = o.customer_id AND a.is_default = TRUE)
        LIMIT 1
     ) ca ON TRUE
     ${SUPPLIER_POS_FOR_ORDER}
     ${ORDER_QTY}
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [orderId, supplierId]
  );
  if (!orderRows.length) return null;
  const order = orderRows[0];

  // Line items without the customer's prices. Garment weight comes from the
  // BlankTex size spec, as on the shop's page; if that schema is unavailable the
  // lines still load without it.
  let items = [];
  if (order.order_type === 'apparel') {
    const apparel = (withWeight) => db.query(
      `SELECT oi.id, oi.item, oi.brand, oi.model, oi.catalog_sku, oi.category, oi.style_description,
              oi.color, oi.size, oi.qty, oi.artwork_no, oi.artwork_size, oi.decoration_method,
              oi.production_status, oi.notes,
              oi.front_image, oi.back_image, oi.front_mockup, oi.back_mockup, oi.product_image
              ${withWeight ? `, ROUND(wsp.garment_weight_g / 453.59237, 2) AS unit_weight_lbs,
                              ROUND(wsp.garment_weight_g * oi.qty / 453.59237, 2) AS line_weight_lbs` : ''}
         FROM order_items_apparel oi
         ${withWeight ? 'LEFT JOIN blanktex.style_size_specs wsp ON wsp.style_size_id = oi.catalog_size_id' : ''}
        WHERE oi.order_id = $1
        ORDER BY oi.sort_order`,
      [orderId]
    );
    ({ rows: items } = await apparel(true).catch(() => apparel(false)));
  } else if (order.order_type === 'gangsheet') {
    ({ rows: items } = await db.query(
      `SELECT id, size, no_artworks, qty, front_image, back_image, artworks, production_status
         FROM order_items_gangsheet WHERE order_id = $1 ORDER BY sort_order`, [orderId]));
  } else if (order.order_type === 'dtf') {
    ({ rows: items } = await db.query(
      `SELECT id, artwork_name, artwork_no, size, width_inches, height_inches, qty, production_status, notes,
              front_image, back_image, artwork_image
         FROM order_items_dtf WHERE order_id = $1 ORDER BY sort_order`, [orderId]));
  }
  items = items.map((i) => ({
    ...i,
    unit_weight_lbs: money(i.unit_weight_lbs),
    line_weight_lbs: money(i.line_weight_lbs),
    width_inches: money(i.width_inches),
    height_inches: money(i.height_inches),
  }));

  const [artworks, shipments, purchaseOrders, updates] = await Promise.all([
    artworksForOrders([orderId], supplierId),
    shipmentsFor({ orderIds: [orderId] }),
    db.query(
      `SELECT p.id, p.po_number, p.status::text AS status, p.po_type, p.po_scope,
              COALESCE(p.order_date, p.created_at::date) AS issue_date, p.tracking_number, p.carrier
         FROM purchase_orders p
        WHERE p.deleted_at IS NULL AND p.supplier_id = $2
          AND (p.order_id = $1 OR EXISTS (SELECT 1 FROM po_orders poo WHERE poo.po_id = p.id AND poo.order_id = $1))
          AND EXISTS (SELECT 1 FROM portal_po_visibility ppv
                       WHERE ppv.po_id = p.id AND ppv.supplier_id = $2 AND ppv.is_visible = TRUE)
        ORDER BY p.po_number`,
      [orderId, supplierId]
    ),
    getStatusUpdates(supplierId, orderId),
  ]);

  // Ship-to: the order's own text, else its address-book entry, else the
  // customer's address — the same fallbacks the shop uses.
  const cityLine = (city, state, zip) => [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const fromBook = [order.a_line1, order.a_line2, cityLine(order.a_city, order.a_state, order.a_zip), order.a_country].filter(Boolean).join('\n');
  const fromCustomer = [order.c_line1, cityLine(order.c_city, order.c_state, order.c_zip), order.c_country].filter(Boolean).join('\n');
  const shipTo = {
    name: order.shipping_name || order.a_contact || order.customer_name || null,
    address: order.shipping_address || fromBook || fromCustomer || null,
    source: order.shipping_address ? 'order' : fromBook ? 'address_book' : fromCustomer ? 'customer' : null,
  };
  for (const k of ['c_line1', 'c_city', 'c_state', 'c_zip', 'c_country', 'a_contact', 'a_line1', 'a_line2', 'a_city', 'a_state', 'a_zip', 'a_country']) {
    delete order[k];
  }

  const latest = shipments[0];
  const totalWeight = items.reduce((sum, i) => sum + (i.line_weight_lbs || 0), 0);
  const imageCount = new Set(items.flatMap((i) => [i.front_image, i.back_image, i.artwork_image].filter(Boolean))).size;
  const pieces = order.total_qty ?? items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

  return {
    ...order,
    shipping_name: shipTo.name,
    shipping_address: shipTo.address,
    ship_to: shipTo,
    courier: order.courier || latest?.carrier || null,
    tracking_number: order.tracking_number || latest?.tracking_number || null,
    items,
    artworks,
    shipments,
    purchase_orders: purchaseOrders.rows,
    updates,
    stats: {
      total_pieces: pieces,
      total_weight_lbs: totalWeight ? Math.round(totalWeight * 100) / 100 : null,
      print_locations: order.total_print_locations || imageCount || null,
      artworks: artworks.length,
      shipments: shipments.length,
    },
  };
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function getSupplierPODetail(supplierId, poId) {
  const { rows: vis } = await db.query(
    `SELECT 1 FROM portal_po_visibility WHERE po_id = $1 AND supplier_id = $2 AND is_visible = TRUE`,
    [poId, supplierId]
  );
  if (!vis.length) return null;

  // The supplier's own document: its costs, dates and delivery details — never
  // the shop's internal notes or the customer's prices.
  const { rows: poRows } = await db.query(
    `SELECT po.id, po.po_number, po.status::text AS status, po.po_type, po.po_scope,
            po.order_date, po.created_at, po.expected_date,
            COALESCE(po.need_by_date, po.required_dispatch_date, po.expected_date, o.due_date) AS due_date,
            po.required_dispatch_text, po.production_priority, po.print_type, po.brand,
            po.currency, po.subtotal, po.total_discount, po.total_tax,
            COALESCE(NULLIF(po.freight_charges, 0), po.shipping_charge) AS freight_charges,
            po.other_charges, COALESCE(po.grand_total, po.total) AS grand_total,
            po.shipping_method, po.delivery_type,
            po.tracking_number, po.carrier, po.tracking_notes,
            COALESCE(NULLIF(po.supplier_notes, ''), po.notes) AS notes,
            s.name AS supplier_name,
            po.order_id, o.order_number, o.order_type, o.status::text AS order_status,
            o.shipping_name, o.shipping_address, o.contact_name, o.contact_phone
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN orders o ON o.id = po.order_id
      WHERE po.id = $1 AND po.deleted_at IS NULL`,
    [poId]
  );
  if (!poRows.length) return null;
  const po = poRows[0];
  for (const k of ['subtotal', 'total_discount', 'total_tax', 'freight_charges', 'other_charges', 'grand_total']) {
    po[k] = money(po[k]);
  }

  const { rows: linked } = await db.query(
    // The PO's own order is kept even when it was later deleted (free replacement
    // orders were, while their POs stayed live); other covered orders must be live.
    `SELECT o.id, o.order_number, (o.deleted_at IS NOT NULL) AS archived FROM orders o
      WHERE o.id = $2
         OR (o.deleted_at IS NULL AND o.id IN (SELECT order_id FROM po_orders WHERE po_id = $1))
      ORDER BY o.order_number`,
    [poId, po.order_id]
  );
  const orderIds = linked.map((o) => o.id);

  // A PO's own lines, where it has them. Most POs here were raised straight from
  // a sales order and carry none — then the order's lines are what the factory
  // is making, shown without the customer's prices.
  let items_source = 'purchase_order';
  let { rows: items } = await db.query(
    `SELECT id, item_name, description, hsn_code, uom, qty_ordered, unit_price, discount_pct, tax_pct, line_total,
            brand, color, size, catalog_sku AS style, artwork_no, print_type,
            COALESCE(front_mockup, front_image) AS image, product_image
       FROM purchase_order_items WHERE po_id = $1 ORDER BY sort_order, created_at`,
    [poId]
  );
  if (!items.length) {
    ({ rows: items } = await db.query(
      `SELECT id, COALESCE(item_name, item_description) AS item_name, item_description AS description,
              hsn_code, uom, quantity AS qty_ordered, supplier_unit_cost AS unit_price,
              discount_pct, tax_pct, supplier_line_cost AS line_total,
              brand, color, size, style_no AS style, source_artwork_no AS artwork_no, print_type,
              front_image AS image, product_image
         FROM po_apparel_items WHERE purchase_order_id = $1 ORDER BY sort_order, line_no`,
      [poId]
    ));
    if (items.length) items_source = 'purchase_order';
  }
  if (!items.length && orderIds.length) {
    items_source = 'sales_order';
    ({ rows: items } = await db.query(
      `SELECT i.id, i.item AS item_name, i.style_description AS description, NULL AS hsn_code, 'pcs' AS uom,
              i.qty AS qty_ordered, NULL::numeric AS unit_price, NULL::numeric AS discount_pct,
              NULL::numeric AS tax_pct, NULL::numeric AS line_total,
              i.brand, i.color, i.size, COALESCE(i.catalog_sku, i.model) AS style, i.artwork_no,
              i.decoration_method AS print_type,
              COALESCE(i.front_mockup, i.front_image) AS image, i.product_image, o.order_number
         FROM order_items_apparel i JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = ANY($1::uuid[])
       UNION ALL
       SELECT i.id, i.artwork_name, NULL, NULL, 'pcs', i.qty, NULL, NULL, NULL, NULL,
              NULL, NULL, i.size, NULL, i.artwork_no, 'DTF',
              COALESCE(i.artwork_image, i.front_image), NULL, o.order_number
         FROM order_items_dtf i JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = ANY($1::uuid[])
       UNION ALL
       SELECT g.id, 'Gangsheet ' || COALESCE(g.size, ''), NULL, NULL, 'sheets', g.qty, NULL, NULL, NULL, NULL,
              NULL, NULL, g.size, NULL, NULL, 'Gangsheet', g.front_image, NULL, o.order_number
         FROM order_items_gangsheet g JOIN orders o ON o.id = g.order_id
        WHERE g.order_id = ANY($1::uuid[])
        ORDER BY 18, 2`,
      [orderIds]
    ));
  }
  items = items.map((i) => ({
    ...i,
    qty_ordered:  money(i.qty_ordered),
    unit_price:   money(i.unit_price),
    discount_pct: money(i.discount_pct) ?? 0,
    tax_pct:      money(i.tax_pct) ?? 0,
    line_total:   money(i.line_total),
  }));

  const [shipments, artworks] = await Promise.all([
    shipmentsFor({ poId, orderIds }),
    artworksForOrders(orderIds, supplierId),
  ]);

  return {
    ...po,
    items,
    items_source,
    total_qty: items.reduce((s, i) => s + (i.qty_ordered ?? 0), 0),
    orders: linked,
    shipments,
    artworks,
  };
}

async function getSupplierPOs(supplierId, { page = 1, limit = 10, search, status } = {}) {
  page  = Math.max(1, parseInt(page) || 1);
  limit = Math.min(500, Math.max(1, parseInt(limit) || 10));
  const offset     = (page - 1) * limit;
  const conditions = ['ppv.supplier_id = $1', 'ppv.is_visible = TRUE', 'po.deleted_at IS NULL'];
  const params     = [supplierId];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(po.po_number ILIKE $${params.length} OR o.order_number ILIKE $${params.length})`);
  }
  if (status) { params.push(status); conditions.push(`po.status::text = $${params.length}`); }
  const where = conditions.join(' AND ');

  const [dataRes, countRes, statusRes] = await Promise.all([
    db.query(
      `SELECT po.id, po.po_number, po.status::text AS status, po.po_type, po.po_scope,
              COALESCE(po.order_date, po.created_at::date) AS issue_date, po.expected_date,
              COALESCE(po.need_by_date, po.required_dispatch_date, po.expected_date, o.due_date) AS due_date,
              COALESCE(po.grand_total, po.total) AS total,
              po.order_id, o.order_number, po.tracking_number, po.carrier
       FROM portal_po_visibility ppv
       JOIN purchase_orders po ON po.id = ppv.po_id
       LEFT JOIN orders o ON o.id = po.order_id
       WHERE ${where}
       ORDER BY COALESCE(po.order_date, po.created_at::date) DESC, po.po_number DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    db.query(
      `SELECT COUNT(*) FROM portal_po_visibility ppv
         JOIN purchase_orders po ON po.id = ppv.po_id
         LEFT JOIN orders o ON o.id = po.order_id
        WHERE ${where}`,
      params
    ),
    db.query(
      `SELECT po.status::text AS status, COUNT(*)::int AS count
         FROM portal_po_visibility ppv JOIN purchase_orders po ON po.id = ppv.po_id
        WHERE ppv.supplier_id = $1 AND ppv.is_visible = TRUE AND po.deleted_at IS NULL
        GROUP BY 1`,
      [supplierId]
    ),
  ]);

  return {
    purchaseOrders: dataRes.rows.map((r) => ({ ...r, total: money(r.total) })),
    total: parseInt(countRes.rows[0].count),
    statusCounts: statusRes.rows,
  };
}

// ── Artworks ──────────────────────────────────────────────────────────────────

async function getSupplierArtworks(supplierId) {
  const { rows } = await db.query(
    `SELECT pov.order_id FROM portal_order_visibility pov
       JOIN orders o ON o.id = pov.order_id AND o.deleted_at IS NULL
      WHERE pov.supplier_id = $1 AND pov.is_visible = TRUE`,
    [supplierId]
  );
  return artworksForOrders(rows.map((r) => r.order_id), supplierId);
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
  getVaultAssetForSupplier,
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
