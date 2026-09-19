/**
 * The data behind Supplier Management → "Issue PO to Supplier": BlankTex's New
 * Order screen, brought into Printshop (owner, 19 Sep 2026). Read-only for now —
 * the order is still placed with DIGI from BlankTex; placing it from here is the
 * next step. Every DIGI order here is filled from a Printshop PO (see below).
 *
 * The catalogue is BlankTex's own New Order catalogue, read from the same tables
 * (blanktex.supplier_catalog_*) with the same narrowing BlankTex applies
 * (backend/src/routes/purchases.js GET /purchases/catalog in /root/BlankTex), so
 * both screens offer exactly the same styles, colours and sizes. BlankTex itself
 * is not called or changed.
 *
 * The sales-order / PO pickers mirror the BlankTex bridge routes in
 * crm/crm.routes.js (which authenticate BlankTex's service, not a person); these
 * answer a signed-in Printshop user instead. crm.routes.js is left untouched.
 */
const db = require('../../config/db')

// ── Catalogue (same rules as BlankTex) ───────────────────────────────────────
// DIGI/RIIN exposes one global colour + size palette, never a per-style one, so a
// supplier style is narrowed through the curated style with the same style_no.
// `supplier` / `styleCode` are SQL expressions, never user input.
const sizeMatch = `(COALESCE(mz.supplier_size_code,mz.size_code)=z.size_code
       OR UPPER(mz.size_code)=UPPER(z.size_code) OR UPPER(mz.size_name)=UPPER(z.display_name)
       OR UPPER(mz.size_name)=UPPER(z.size_name))`

const matchedStyleColorsSql = (supplier, styleCode) => `
    SELECT c.supplier_color_id, c.color_code supplier_color_code,
           mc.display_name, mc.color_name, mc.sort_order
      FROM blanktex.styles ms
      JOIN blanktex.style_colors mc ON mc.style_id=ms.style_id AND mc.active=TRUE
      JOIN LATERAL (
        SELECT candidate.*
          FROM blanktex.supplier_catalog_colors candidate
         WHERE candidate.supplier_id=${supplier} AND candidate.active=TRUE
           AND (
             UPPER(COALESCE(mc.supplier_color_code,mc.internal_color_code))=UPPER(candidate.color_code)
             OR LOWER(mc.display_name)=LOWER(candidate.display_name)
             OR LOWER(mc.color_name)=LOWER(candidate.color_name)
           )
         ORDER BY
           (UPPER(COALESCE(mc.supplier_color_code,mc.internal_color_code))=UPPER(candidate.color_code)) DESC,
           candidate.color_code
         LIMIT 1
      ) c ON TRUE
     WHERE UPPER(ms.style_no)=UPPER(${styleCode})`

const styleColorIdsSql = (supplier, styleCode) => `
    SELECT ARRAY_AGG(m.supplier_color_id ORDER BY m.sort_order,m.display_name) ids
      FROM (${matchedStyleColorsSql(supplier, styleCode)}) m`
const styleColorsSql = (supplier, styleCode) => `
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
             'style_color_id',m.supplier_color_id,
             'display_name',m.display_name,
             'color_name',m.color_name,
             'color_code',m.supplier_color_code
           ) ORDER BY m.sort_order,m.display_name) colors
      FROM (${matchedStyleColorsSql(supplier, styleCode)}) m`
const styleSizeIdsSql = (supplier, styleCode) => `
    SELECT ARRAY_AGG(DISTINCT z.supplier_size_id) ids
      FROM blanktex.styles ms
      JOIN blanktex.style_sizes mz ON mz.style_id=ms.style_id AND mz.active=TRUE
      JOIN blanktex.supplier_catalog_sizes z ON z.supplier_id=${supplier} AND z.active=TRUE AND ${sizeMatch}
     WHERE ms.style_no=${styleCode}`
const styleSizeWeightsSql = (supplier, styleCode) => `
    SELECT JSONB_OBJECT_AGG(w.size_id, w.grams) weights FROM (
      SELECT z.supplier_size_id size_id, MAX(sp.garment_weight_g) grams
        FROM blanktex.styles ms
        JOIN blanktex.style_sizes mz ON mz.style_id=ms.style_id AND mz.active=TRUE
        JOIN blanktex.style_size_specs sp ON sp.style_size_id=mz.style_size_id AND sp.garment_weight_g IS NOT NULL
        JOIN blanktex.supplier_catalog_sizes z ON z.supplier_id=${supplier} AND z.active=TRUE AND ${sizeMatch}
       WHERE ms.style_no=${styleCode}
       GROUP BY z.supplier_size_id) w`

async function catalog() {
  const [suppliers, styles, colors, sizes] = await Promise.all([
    db.query(`SELECT supplier_id,supplier_code,supplier_name,api_available,api_provider,
                     (api_available=TRUE AND UPPER(COALESCE(api_provider,''))='RIIN') can_place_order
                FROM blanktex.suppliers WHERE default_status='Active' ORDER BY supplier_name`),
    db.query(`SELECT s.supplier_style_id style_id,s.supplier_id,s.style_code style_no,s.display_name style_name,
                     s.craft_types,s.images,
                     COALESCE(cids.ids,'{}') color_ids,COALESCE(cols.colors,'[]'::jsonb) colors,
                     COALESCE(zids.ids,'{}') size_ids,
                     COALESCE(wts.weights,'{}'::jsonb) size_weights
                FROM blanktex.supplier_catalog_styles s
                LEFT JOIN LATERAL (${styleColorIdsSql('s.supplier_id', 's.style_code')}) cids ON TRUE
                LEFT JOIN LATERAL (${styleColorsSql('s.supplier_id', 's.style_code')}) cols ON TRUE
                LEFT JOIN LATERAL (${styleSizeIdsSql('s.supplier_id', 's.style_code')}) zids ON TRUE
                LEFT JOIN LATERAL (${styleSizeWeightsSql('s.supplier_id', 's.style_code')}) wts ON TRUE
               WHERE s.active=TRUE AND s.enabled=TRUE ORDER BY s.supplier_id,s.display_name,s.style_code`),
    db.query(`SELECT supplier_color_id style_color_id,supplier_id,color_code,display_name color_name,display_name
                FROM blanktex.supplier_catalog_colors WHERE active=TRUE ORDER BY supplier_id,display_name,color_code`),
    db.query(`SELECT supplier_size_id style_size_id,supplier_id,size_code,display_name size_name
                FROM blanktex.supplier_catalog_sizes WHERE active=TRUE ORDER BY supplier_id,display_name,size_code`),
  ])
  return { suppliers: suppliers.rows, styles: styles.rows, colors: colors.rows, sizes: sizes.rows }
}

// ── Sales order → its PO → the whole order (owner, 19 Sep 2026) ─────────────
// Nothing is typed from scratch: a DIGI order is filled from a Printshop PO, and
// a PO is only offered while no DIGI order has been placed from it yet. So:
//   - a PO is "open" while it is an apparel PO, not cancelled, and has no live
//     DIGI order — neither one the DIGI sync linked to it (digi_orders.po_id,
//     cancelled/refunded DIGI orders aside) nor one BlankTex placed from it
//     (blanktex.purchases.printshop_po_id, a failed submission aside);
//   - only POs raised to the chosen supplier (the Printshop supplier whose name
//     starts with the BlankTex supplier code — DIGI → "DIGI");
//   - a sales order is offered only while it has an open PO.
const OPEN_PO = `
      po.deleted_at IS NULL AND po.po_type = 'apparel' AND po.status::text <> 'Cancelled'
  AND NOT EXISTS (SELECT 1 FROM digi_orders d WHERE d.po_id = po.id AND COALESCE(d.order_status, 0) NOT IN (13, 15))
  AND NOT EXISTS (SELECT 1 FROM blanktex.purchases bp WHERE bp.printshop_po_id = po.id
                   AND COALESCE(bp.submission_status, '') <> 'Failed')`
const OF_SUPPLIER = (param) => `EXISTS (SELECT 1 FROM suppliers ps WHERE ps.id = po.supplier_id
                                AND UPPER(ps.name) LIKE UPPER(${param}) || '%')`
const PO_OF_ORDER = `(po.order_id = $1 OR EXISTS (SELECT 1 FROM po_orders poo WHERE poo.po_id = po.id AND poo.order_id = $1))`

async function salesOrders(supplierCode) {
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.sales_channel, o.status, o.order_date,
            cust.name AS customer_name,
            COALESCE((SELECT SUM(qty) FROM order_items_apparel WHERE order_id = o.id), 0)::int AS total_qty,
            open_po.n AS open_po_count
       FROM orders o
       LEFT JOIN customers cust ON cust.id = o.customer_id
       CROSS JOIN LATERAL (
         SELECT COUNT(DISTINCT po.id)::int AS n FROM purchase_orders po
          WHERE ${OPEN_PO} AND ${OF_SUPPLIER('$1')} AND ${PO_OF_ORDER.replace(/\$1/g, 'o.id')}
       ) open_po
      WHERE o.deleted_at IS NULL AND o.order_type = 'apparel' AND open_po.n > 0
      ORDER BY o.order_date DESC NULLS LAST, o.created_at DESC
      LIMIT 200`, [supplierCode])
  return rows
}

async function orderPurchaseOrders(orderId, supplierCode) {
  const { rows } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.po_scope, po.order_date, po.created_at,
            COALESCE(s.name, po.vendor_name) AS supplier_name,
            COALESCE(it.item_count, 0)::int AS item_count,
            COALESCE(it.total_qty, 0)::int AS total_qty
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS item_count, SUM(qty_ordered) AS total_qty
           FROM purchase_order_items WHERE po_id = po.id
       ) it ON TRUE
      WHERE ${OPEN_PO} AND ${OF_SUPPLIER('$2')} AND ${PO_OF_ORDER}
      ORDER BY po.created_at, po.po_number`, [orderId, supplierCode])
  return rows
}

async function customerShipTo(customerId) {
  if (!customerId) return null
  const { rows } = await db.query(
    `SELECT name, company_name, email, phone, mobile_number, company_phone_number,
            address_line1, city, state, zip, country
       FROM customers WHERE id = $1 AND deleted_at IS NULL`, [customerId])
  return rows[0] || null
}

async function addressShipTo(shipTo, addressId) {
  if (!addressId) return shipTo
  const { rows } = await db.query(
    `SELECT contact_person, line1, line2, city, state, zipcode, country
       FROM customer_addresses WHERE id = $1`, [addressId])
  const a = rows[0]
  if (!a) return shipTo
  return {
    ...(shipTo || {}),
    name: a.contact_person || shipTo?.name || null,
    address_line1: a.line1, address_line2: a.line2,
    city: a.city, state: a.state, zip: a.zipcode, country: a.country,
  }
}

// A line's print image: its own, else its sales-order line's, else the file of
// the Artwork Vault artwork picked on it.
const IMAGE = (own, src) => `COALESCE(NULLIF(${own}, ''), NULLIF(${src}, ''))`

// One open PO of that sales order, everything a DIGI order needs: its lines with
// the catalogue codes they were picked with and their artwork, the recipient, the
// carrier. A full PO saved without lines buys every line of its sales order.
// A partial PO without lines cannot say what it covers, so nothing is filled.
async function purchaseOrder(orderId, poId, supplierCode) {
  const { rows: poRows } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.po_scope, po.order_id, po.customer_id,
            po.shipping_address_id, po.carrier
       FROM purchase_orders po
      WHERE po.id = $2 AND ${OPEN_PO} AND ${OF_SUPPLIER('$3')} AND ${PO_OF_ORDER}`, [orderId, poId, supplierCode])
  const po = poRows[0]
  if (!po) return null
  const { rows: orderRows } = await db.query(
    `SELECT id, order_number, customer_id, shipping_name, shipping_address, shipping_address_id,
            contact_name, contact_phone, contact_email
       FROM orders WHERE id = $1 AND deleted_at IS NULL`, [orderId])
  const order = orderRows[0] || null
  const { rows: items } = await db.query(
    `SELECT poi.id, poi.item_name AS item, poi.qty_ordered AS qty, poi.color, poi.size,
            poi.brand, poi.catalog_sku, poi.style_description,
            st.style_no AS model, st.style_no,
            COALESCE(NULLIF(sc.supplier_color_code, ''), sc.internal_color_code) AS color_code,
            COALESCE(NULLIF(sz.supplier_size_code, ''), sz.size_code) AS size_code,
            COALESCE(${IMAGE('poi.front_image', 'src.front_image')}, NULLIF(aw.file_url, '')) AS front_image,
            ${IMAGE('poi.back_image', 'src.back_image')}     AS back_image,
            ${IMAGE('poi.front_mockup', 'src.front_mockup')} AS front_mockup,
            ${IMAGE('poi.back_mockup', 'src.back_mockup')}   AS back_mockup
       FROM purchase_order_items poi
       LEFT JOIN blanktex.styles st       ON st.style_id = poi.catalog_style_id
       LEFT JOIN blanktex.style_colors sc ON sc.style_color_id = poi.catalog_color_id
       LEFT JOIN blanktex.style_sizes sz  ON sz.style_size_id = poi.catalog_size_id
       LEFT JOIN artworks aw ON aw.id = poi.artwork_id
       LEFT JOIN order_items_apparel src
              ON poi.source_line_table = 'order_items_apparel' AND src.id = poi.source_line_id
      WHERE poi.po_id = $1 AND poi.qty_ordered > 0
      ORDER BY poi.sort_order, poi.created_at`, [po.id])
  let items_source = items.length ? 'purchase_order' : 'none'
  let lines = items
  if (!items.length && po.po_scope !== 'partial') {
    const { rows: soLines } = await db.query(
      `SELECT oi.id, oi.item, oi.qty, oi.color, oi.size, oi.brand, oi.catalog_sku, oi.style_description,
              COALESCE(st.style_no, oi.model) AS model, st.style_no,
              COALESCE(NULLIF(sc.supplier_color_code, ''), sc.internal_color_code) AS color_code,
              COALESCE(NULLIF(sz.supplier_size_code, ''), sz.size_code) AS size_code,
              oi.front_image, oi.back_image, oi.front_mockup, oi.back_mockup
         FROM order_items_apparel oi
         LEFT JOIN blanktex.styles st       ON st.style_id = oi.catalog_style_id
         LEFT JOIN blanktex.style_colors sc ON sc.style_color_id = oi.catalog_color_id
         LEFT JOIN blanktex.style_sizes sz  ON sz.style_size_id = oi.catalog_size_id
        WHERE oi.order_id = $1 AND oi.qty > 0
        ORDER BY oi.sort_order`, [orderId])
    if (soLines.length) { lines = soLines; items_source = 'sales_order' }
  }
  const baseShipTo = await customerShipTo(po.customer_id || order?.customer_id)
  const ship_to = await addressShipTo(await addressShipTo(baseShipTo, order?.shipping_address_id), po.shipping_address_id)
  return { ...po, order, items: lines, items_source, ship_to }
}

module.exports = { catalog, salesOrders, orderPurchaseOrders, purchaseOrder }
