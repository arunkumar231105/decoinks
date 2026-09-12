'use strict'

/**
 * What a sales order still has left to buy.
 *
 * One sales order can be bought in several purchase orders: a full one, or a
 * run of partial ones. Each PO line says which sales order line it issues
 * (source_line_id) and how many of it (qty_ordered), so the figures the form
 * shows are counted from the purchase orders themselves every time:
 *
 *   Total Qty  — what the sales order line says. Read-only in a PO; it is
 *                changed on the sales order and follows here by itself.
 *   Issued     — the sum of that line on every other live purchase order.
 *   Available  — Total Qty − Issued: what is left to issue.
 *   Current    — how many THIS purchase order issues (the only figure typed).
 *   Balance    — Available − Current: what is left after this one.
 *
 * Nothing keeps a separate running total, so nothing can drift, and deleting a
 * purchase order gives its pieces back on its own.
 */

const { query } = require('../../config/db')

const LINE_SOURCES = [
  { table: 'order_items_apparel',   name: 'item',          extra: `a.color, a.size, a.category, a.brand, a.catalog_sku,
                                                                   a.catalog_style_id, a.catalog_color_id, a.catalog_size_id,
                                                                   a.product_image, a.style_description, a.artwork_no, a.artwork_size,
                                                                   a.front_image, a.back_image, NULL::text AS sheet_size` },
  { table: 'order_items_dtf',       name: 'artwork_name',  extra: `NULL AS color, a.size, 'DTF Transfer'::text AS category, NULL AS brand, NULL AS catalog_sku,
                                                                   NULL::uuid AS catalog_style_id, NULL::uuid AS catalog_color_id, NULL::uuid AS catalog_size_id,
                                                                   a.artwork_image AS product_image, NULL::text AS style_description, a.artwork_no, a.size AS artwork_size,
                                                                   a.front_image, a.back_image, NULL::text AS sheet_size` },
  { table: 'order_items_gangsheet', name: 'size',          extra: `NULL AS color, a.size, 'Gangsheet'::text AS category, NULL AS brand, NULL AS catalog_sku,
                                                                   NULL::uuid AS catalog_style_id, NULL::uuid AS catalog_color_id, NULL::uuid AS catalog_size_id,
                                                                   a.front_image AS product_image, NULL::text AS style_description, NULL AS artwork_no, a.size AS artwork_size,
                                                                   a.front_image, a.back_image, a.size AS sheet_size` },
]

const priceColumn = table => (table === 'order_items_gangsheet' ? 'price_per_sheet' : 'unit_price')

/**
 * Every line of the given sales orders with its issued and available figures.
 * `excludePoId` leaves one purchase order out of "issued", which is what an
 * edit needs: its own pieces are not competing with itself.
 */
async function issuePlan(orderIds, { excludePoId = null, client = null } = {}) {
  const ids = (orderIds || []).filter(Boolean)
  if (!ids.length) return { lines: [], orders: [] }
  // Read on the caller's connection when there is one, so a create or edit
  // counts what is already issued inside its own transaction — under the
  // advisory lock it has just taken — rather than from another connection.
  const read = client ? (sql, params) => client.query(sql, params) : query

  const selects = LINE_SOURCES.map(source => `
    SELECT a.id AS line_id, '${source.table}'::text AS line_table, a.order_id, o.order_number,
           a.${source.name} AS item_name, ${source.extra},
           COALESCE(a.qty, 0)::int AS total_qty,
           COALESCE(a.${priceColumn(source.table)}, 0)::numeric AS unit_price,
           COALESCE(a.sort_order, 0) AS sort_order,
           COALESCE((
             SELECT SUM(i.qty_ordered)::int FROM purchase_order_items i
               JOIN purchase_orders p ON p.id = i.po_id AND p.deleted_at IS NULL
              WHERE i.source_line_table = '${source.table}' AND i.source_line_id = a.id
                AND ($2::uuid IS NULL OR p.id <> $2::uuid)), 0) AS issued
      FROM ${source.table} a
      JOIN orders o ON o.id = a.order_id AND o.deleted_at IS NULL
     WHERE a.order_id = ANY($1::uuid[])`)

  const { rows } = await read(
    `${selects.join('\n    UNION ALL\n')}\n    ORDER BY order_number, line_table, sort_order, line_id`,
    [ids, excludePoId])

  const lines = rows.map(r => ({
    ...r,
    total_qty: Number(r.total_qty),
    issued: Number(r.issued),
    available: Math.max(0, Number(r.total_qty) - Number(r.issued)),
    unit_price: Number(r.unit_price),
  }))

  const { rows: orders } = await read(
    `SELECT o.id AS order_id, o.order_number, o.order_type::text AS order_type, o.status::text AS status,
            COALESCE((SELECT COUNT(*)::int FROM purchase_orders p
                       WHERE p.deleted_at IS NULL AND p.order_id = o.id
                         AND ($2::uuid IS NULL OR p.id <> $2::uuid)), 0) AS po_count
       FROM orders o WHERE o.id = ANY($1::uuid[]) AND o.deleted_at IS NULL
      ORDER BY o.order_number`, [ids, excludePoId])

  return {
    lines,
    orders: orders.map(o => {
      const own = lines.filter(l => l.order_id === o.order_id)
      const total = own.reduce((s, l) => s + l.total_qty, 0)
      const issued = own.reduce((s, l) => s + l.issued, 0)
      return { ...o, total_qty: total, issued, available: Math.max(0, total - issued), fully_issued: total > 0 && issued >= total }
    }),
  }
}

/**
 * Refuses a purchase order that would issue more than its sales order has left.
 * Called inside the create/update transaction, under an advisory lock per sales
 * order, so two people cannot issue the last pieces at the same moment.
 */
async function assertIssuable({ client, orderIds, scope, items, excludePoId = null }) {
  const ids = (orderIds || []).filter(Boolean)
  if (!ids.length) return
  for (const id of ids) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`PO:ISSUE:${id}`])
  }

  const plan = await issuePlan(ids, { excludePoId, client })
  if (!plan.lines.length) return                 // an order with no lines: nothing to police

  const named = plan.orders.map(o => o.order_number).join(', ')
  const availableTotal = plan.lines.reduce((sum, line) => sum + line.available, 0)
  if (availableTotal <= 0) {
    throw Object.assign(new Error(
      `${named} is fully issued — every piece is already on a purchase order, so there is nothing left to raise.`),
      { statusCode: 422 })
  }

  const byLine = new Map(plan.lines.map(line => [line.line_id, line]))
  const asked = new Map()
  for (const item of items || []) {
    if (!item.source_line_id) continue
    const line = byLine.get(item.source_line_id)
    if (!line) {
      throw Object.assign(new Error('A line on this purchase order does not belong to the sales order it covers.'), { statusCode: 422 })
    }
    asked.set(line.line_id, (asked.get(line.line_id) || 0) + Number(item.qty_ordered || 0))
  }

  // A gangsheet purchase order covers whole orders rather than lines, and a
  // hand-typed line issues nothing of the order: neither is policed here. But a
  // purchase order that calls itself full or partial and issues nothing is a
  // mistake, not a gangsheet.
  if (!asked.size) {
    if (scope) {
      throw Object.assign(new Error(
        `This purchase order issues nothing from ${named}. Enter Current on at least one line.`), { statusCode: 422 })
    }
    return
  }

  for (const [lineId, qty] of asked) {
    const line = byLine.get(lineId)
    if (qty > line.available) {
      const which = [line.item_name, line.color, line.size].filter(Boolean).join(' · ') || 'A line'
      throw Object.assign(new Error(
        `${which}: ${qty} is more than the ${line.available} still to issue (${line.total_qty} ordered, ${line.issued} already issued).`),
        { statusCode: 422 })
    }
  }

  if (scope === 'full') {
    if (plan.orders.some(o => o.po_count > 0)) {
      throw Object.assign(new Error(
        `${named} already has a purchase order, so this one can only be partial.`), { statusCode: 422 })
    }
    const short = plan.lines.filter(line => (asked.get(line.line_id) || 0) !== line.available)
    if (short.length) {
      throw Object.assign(new Error(
        'A full purchase order must issue every piece the sales order has. Choose Partial PO to issue part of it.'),
        { statusCode: 422 })
    }
  }

  if (asked.size && [...asked.values()].reduce((a, b) => a + b, 0) <= 0) {
    throw Object.assign(new Error('Enter how many pieces this purchase order issues.'), { statusCode: 422 })
  }
}

module.exports = { issuePlan, assertIssuable, LINE_TABLES: LINE_SOURCES.map(s => s.table) }
