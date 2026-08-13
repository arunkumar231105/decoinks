#!/usr/bin/env node
/**
 * One purchase order per sales order — no more, no less.
 *
 * The shop's rule is that every sales order has exactly one PO behind it. Two
 * things had broken that:
 *
 *  1. Deleting a sales order left its PO behind. Three POs (TSI 260730-64,
 *     260730-65, 260731-67) still sit in the list with no order, $0.00, no line
 *     items — the shells of orders the owner removed by hand. They are soft
 *     deleted here, the same way the app removes a PO, and their numbers are
 *     parked under a D- prefix so the renumber below cannot collide with them.
 *
 *  2. Four live orders never got a PO. One of them, ORD-2026-0076, has already
 *     been produced and delivered, so the work certainly happened. A PO is
 *     raised for each, mirroring exactly what the order says and what every
 *     other PO in this database does:
 *       vendor          TEXSTONE INC — the supplier on all 79 existing POs
 *       total           the order total; net product = total − shipping
 *       total_artworks  the order's own item quantity (this is how the existing
 *                       pairs line up, e.g. PO-2026-0082 ↔ 11 pieces)
 *       status          Draft, because the sales order is still Draft
 *     Nothing is guessed: total_gangsheets is left empty rather than invented,
 *     and payment_status stays at its 'Unpaid' default — whether the supplier
 *     has been paid is not something this script can know.
 *
 * Finally the PO numbering is closed up so it runs 0001..N with no holes, the
 * same way close-order-number-gaps.js does it for orders: rows keep their
 * existing sequence, only the ones after a hole shift down, and the counters
 * high-water mark comes down with them.
 *
 * Usage:
 *   node backend/scripts/reconcile-po-count-with-orders.js            (dry-run)
 *   node backend/scripts/reconcile-po-count-with-orders.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_db'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const counts = async () => (await client.query(
      `SELECT (SELECT count(*) FROM orders WHERE deleted_at IS NULL)::int AS orders,
              (SELECT count(*) FROM purchase_orders WHERE deleted_at IS NULL)::int AS pos`)).rows[0]
    const before = await counts()
    console.log(`Before — sales orders: ${before.orders}, purchase orders: ${before.pos}\n`)

    // ─── 1. POs whose sales order no longer exists ────────────────────
    const { rows: orphans } = await client.query(
      `SELECT po_number, source_po_number, total, vendor_name, order_date,
              (SELECT count(*) FROM purchase_order_items x WHERE x.po_id = purchase_orders.id)::int AS items
         FROM purchase_orders
        WHERE deleted_at IS NULL AND order_id IS NULL
        ORDER BY po_number`)
    console.log(`POs with no sales order — to be removed: ${orphans.length}`)
    for (const o of orphans) {
      console.log(`  ${o.po_number}  ${o.source_po_number}  $${o.total}  ${o.items} line items  (${o.vendor_name})`)
    }

    // ─── 2. Orders with no PO ─────────────────────────────────────────
    const { rows: missing } = await client.query(
      `SELECT o.id, o.order_number, o.order_type::text AS order_type, o.status::text AS status,
              o.order_date, o.total, o.shipping_charges, o.customer_id,
              (SELECT COALESCE(SUM(qty), 0) FROM (
                 SELECT qty FROM order_items_dtf       WHERE order_id = o.id
                 UNION ALL SELECT qty FROM order_items_gangsheet WHERE order_id = o.id
                 UNION ALL SELECT qty FROM order_items_apparel   WHERE order_id = o.id) x)::int AS qty
         FROM orders o
        WHERE o.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.order_id = o.id AND p.deleted_at IS NULL)
        ORDER BY o.order_number`)
    console.log(`\nOrders with no PO — one will be raised for each: ${missing.length}`)
    for (const m of missing) {
      const ship = Number(m.shipping_charges || 0)
      console.log(`  ${m.order_number}  ${m.order_type.padEnd(8)} $${m.total}  ` +
        `(product $${(Number(m.total) - ship).toFixed(2)} + shipping $${ship.toFixed(2)})  ${m.qty} pcs`)
    }

    const projected = before.pos - orphans.length + missing.length
    console.log(`\nAfter — sales orders: ${before.orders}, purchase orders: ${projected}` +
      `${projected === before.orders ? '  ✓ one PO per order' : '  ✗ still not equal — check this'}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.')
      return
    }

    const { rows: [vendor] } = await client.query(
      `SELECT supplier_id, vendor_name, created_by FROM purchase_orders
        WHERE deleted_at IS NULL AND supplier_id IS NOT NULL AND created_by IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`)
    if (!vendor) throw new Error('Could not resolve the supplier used by the existing POs')

    await client.query('BEGIN')

    // Remove the orphans and park their numbers.
    await client.query(
      `UPDATE purchase_orders SET deleted_at = NOW(), updated_at = NOW()
        WHERE deleted_at IS NULL AND order_id IS NULL`)
    await client.query(
      `UPDATE purchase_orders SET po_number = 'D-' || RIGHT(id::text, 12)
        WHERE deleted_at IS NOT NULL AND po_number NOT LIKE 'D-%'`)

    // Raise the missing POs.
    const { rows: [seed] } = await client.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(po_number, '-', 3) AS int)), 0) AS n
         FROM purchase_orders WHERE po_number ~ '^PO-2026-[0-9]+$'`)
    let n = seed.n
    for (const m of missing) {
      const ship = Number(m.shipping_charges || 0)
      const net = +(Number(m.total) - ship).toFixed(2)
      await client.query(
        `INSERT INTO purchase_orders (po_number, order_id, customer_id, status, po_type,
           order_date, entry_date, subtotal, total, grand_total, net_product_amount,
           shipping_charge, freight_charges, currency, exchange_rate,
           supplier_id, vendor_name, brand, language, priority,
           print_type, total_artworks, created_by, source_system, notes)
         VALUES ($1,$2,$3,'Draft'::po_status,$4,
                 $5::date, CURRENT_DATE, $6,$7,$7,$6,
                 $8,$8,'USD',1.0000,
                 $9,$10,'Decoinks LLC','en','Medium',
                 $11,$12,$13,'decoinks_po_parity_backfill',$14)`,
        [`PO-2026-${String(++n).padStart(4, '0')}`, m.id, m.customer_id,
         m.order_type === 'dtf' ? 'gangsheet' : 'apparel',
         m.order_date, net, Number(m.total), ship,
         vendor.supplier_id, vendor.vendor_name,
         m.order_type === 'dtf' ? 'DTF Transfers' : null, m.qty, vendor.created_by,
         `Raised to match ${m.order_number}, which had no purchase order. Figures mirror the sales order.`])
    }

    // Close the numbering gaps, preserving the existing sequence.
    const { rows: live } = await client.query(
      `SELECT id, po_number, substring(po_number from '-([0-9]{4})-') AS yr
         FROM purchase_orders
        WHERE deleted_at IS NULL AND po_number ~ '^PO-[0-9]{4}-[0-9]+$'
        ORDER BY po_number`)
    const seq = {}
    const moves = []
    for (const r of live) {
      seq[r.yr] = (seq[r.yr] || 0) + 1
      const next = `PO-${r.yr}-${String(seq[r.yr]).padStart(4, '0')}`
      if (next !== r.po_number) moves.push({ id: r.id, from: r.po_number, to: next })
    }
    for (let i = 0; i < moves.length; i++) {
      await client.query(`UPDATE purchase_orders SET po_number = $2 WHERE id = $1`, [moves[i].id, `T-${i}`])
    }
    for (const mv of moves) {
      await client.query(`UPDATE purchase_orders SET po_number = $2, updated_at = NOW() WHERE id = $1`, [mv.id, mv.to])
    }
    for (const [yr, last] of Object.entries(seq)) {
      await client.query(
        `INSERT INTO counters (scope, last_value) VALUES ($1, $2)
         ON CONFLICT (scope) DO UPDATE SET last_value = EXCLUDED.last_value, updated_at = NOW()`,
        [`PO-${yr}`, last])
    }
    await client.query('COMMIT')

    console.log(`\nRemoved ${orphans.length} orphan PO(s), raised ${missing.length} new PO(s), renumbered ${moves.length}.`)
    moves.forEach(mv => console.log(`  ${mv.from} → ${mv.to}`))

    const after = await counts()
    const { rows: [check] } = await client.query(
      `SELECT (SELECT count(*) FROM orders o WHERE o.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.order_id=o.id AND p.deleted_at IS NULL))::int AS orders_without_po,
              (SELECT count(*) FROM purchase_orders p WHERE p.deleted_at IS NULL AND p.order_id IS NULL)::int AS pos_without_order,
              (SELECT max(CAST(SPLIT_PART(po_number,'-',3) AS int)) FROM purchase_orders
                WHERE deleted_at IS NULL AND po_number ~ '^PO-[0-9]{4}-[0-9]+$') AS highest`)
    console.log(`\nSales orders: ${after.orders}, purchase orders: ${after.pos}` +
      ` — orders without a PO: ${check.orders_without_po}, POs without an order: ${check.pos_without_order},` +
      ` highest PO number: ${check.highest}`)
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
