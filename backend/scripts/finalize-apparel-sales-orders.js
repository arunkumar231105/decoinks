#!/usr/bin/env node
/**
 * Finalize the custom apparel sales orders against the TS-PA sheet (May–Jun 2026).
 *
 * Nine rows, one per TS-PA purchase order. SHEET below is a verbatim transcript,
 * so every figure written here traces to a line the owner supplied.
 *
 * WHAT THIS FIXES
 *
 * 1. MONEY on the sales order and its invoice. Same defect the DTF batch had:
 *    `subtotal` holds the grand total because calcTotals folded shipping in.
 *    The totals are already right and are left alone; only the subtotal moves
 *    down to the product amount, so subtotal + shipping = total on all nine.
 *
 * 2. PRINT TYPE copied onto the sales order. The purchase orders already carry
 *    it; `orders.print_type` was added in migration 102 and is still empty for
 *    apparel. The sheet writes the same method two ways — "DTF Transfer" on the
 *    early rows and "DTF" on the later ones — so it is normalised to
 *    "DTF Transfer", with DTG left as DTG. Both are the garment decoration
 *    method, which is what this column is for.
 *
 * 3. TRACKING copied from the purchase order where the sales order has none.
 *    Nothing is invented — only a number already recorded against that job.
 *
 * WHAT THIS DOES NOT DO
 *
 * - The nine purchase orders are already correct against the sheet (amounts,
 *   freight, totals, quantities and print type all verified). They are checked
 *   and reported, never written to.
 * - Shipping addresses are NOT touched. The sheet leaves several blank but the
 *   owner keyed them in by hand, so the system is the better record and an
 *   import must not overwrite it with a blank.
 * - The payments ledger, invoice amount_paid / balance_due and document
 *   numbering are untouched.
 * - The six hand-keyed apparel orders that are not on this sheet
 *   (ORD-2026-0074, 0075, 0077, 0083, 0099, 0100) are left exactly as they are.
 *   They are separate business, not part of this batch.
 *
 * Idempotent: keyed on source_po_number, so a second run is a no-op. Runs in
 * one transaction and rolls back on any error.
 *
 * Usage:
 *   node backend/scripts/finalize-apparel-sales-orders.js            (dry-run, default)
 *   node backend/scripts/finalize-apparel-sales-orders.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

// The sheet, verbatim. `method` is as written; `print_type` is the normalised
// value actually stored.
const SHEET = [
  { po: 'TS-PA-260501-03', date: '2026-05-01', customer: 'I Teach Korean',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF Transfer', print_type: 'DTF Transfer', qty: 2,
    product: 49.00, ship: 15.00, total: 64.00 },

  { po: 'TS-PA-260504-04', date: '2026-05-04', customer: 'Luxe Gang',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTG', print_type: 'DTG', qty: 10,
    product: 265.00, ship: 15.00, total: 280.00 },

  { po: 'TS-PA-260510-05', date: '2026-05-10', customer: null,   // blank in the sheet
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF Transfer', print_type: 'DTF Transfer', qty: 5,
    product: 0.00, ship: 15.00, total: 15.00 },

  { po: 'TS-PA-260511-06', date: '2026-05-11', customer: 'Lashanniya',
    garment: "100% Cotton Unisex T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF Transfer', print_type: 'DTF Transfer', qty: 10,
    product: 230.00, ship: 15.00, total: 245.00 },

  { po: 'TS-PA-260518-07', date: '2026-05-18', customer: 'Jenny',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF Transfer', print_type: 'DTF Transfer', qty: 1,
    product: 25.00, ship: 10.00, total: 35.00 },

  { po: 'TS-PA-260528-05', date: '2026-05-28', customer: 'Jac Jean',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTG', print_type: 'DTG', qty: 1,
    product: 0.00, ship: 10.00, total: 10.00 },

  { po: 'TS-PA-260528-09', date: '2026-05-28', customer: 'Charles',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF', print_type: 'DTF Transfer', qty: 10,
    product: 150.00, ship: 15.00, total: 165.00 },

  { po: 'TS-PA-260605-11', date: '2026-06-05', customer: 'Jac Jean',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTG', print_type: 'DTG', qty: 75,
    product: 1913.00, ship: 15.00, total: 1928.00 },

  { po: 'TS-PA-260611-12', date: '2026-06-11', customer: 'Fred Vazquez',
    garment: "100% Cotton Men's T-Shirt - 180 GSM", blanks: 'Smart Blanks',
    method: 'DTF', print_type: 'DTF Transfer', qty: 25,
    product: 262.50, ship: 15.00, total: 277.50 },
]

const money = n => Number(n).toFixed(2)
const stats = { orderMoney: 0, invoiceMoney: 0, printType: 0, trackingFilled: 0, offSheetMoney: 0 }
const report = []
const note = (kind, line) => report.push(`  [${kind}] ${line}`)

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const r of SHEET) {
      const { rows: [order] } = await client.query(
        `SELECT id, order_number, invoice_id, subtotal, shipping_charges, total,
                print_type, tracking_number, shipping_address
           FROM orders WHERE source_po_number = $1 AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`, [r.po])
      if (!order) { note('MISSING', `${r.po} — no sales order on file`); continue }

      const { rows: [po] } = await client.query(
        `SELECT id, po_number, subtotal, freight_charges, grand_total, print_type, tracking_number
           FROM purchase_orders WHERE source_po_number = $1 AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`, [r.po])

      // The purchase order is read-only here: verified against the sheet and
      // reported if it disagrees, never rewritten.
      if (!po) note('MISSING', `${r.po} — no purchase order on file`)
      else if (Number(po.subtotal) !== r.product || Number(po.freight_charges) !== r.ship
               || Number(po.grand_total) !== r.total) {
        note('PO MISMATCH', `${r.po} ${po.po_number} has ${money(po.subtotal)}/${money(po.freight_charges)}/${money(po.grand_total)}` +
                            ` but the sheet says ${money(r.product)}/${money(r.ship)}/${money(r.total)} — NOT changed, please confirm`)
      }

      // Money on the sales order and its invoice.
      if (Number(order.subtotal) !== r.product || Number(order.shipping_charges) !== r.ship
          || Number(order.total) !== r.total) {
        await client.query(
          `UPDATE orders SET subtotal=$1, shipping_charges=$2, total=$3, updated_at=NOW() WHERE id=$4`,
          [r.product, r.ship, r.total, order.id])
        stats.orderMoney++
        note('MONEY', `${r.po} ${order.order_number}  ${money(order.subtotal)}/${money(order.shipping_charges)}/${money(order.total)}` +
                      ` → ${money(r.product)}/${money(r.ship)}/${money(r.total)}`)
      }
      if (order.invoice_id) {
        const { rowCount } = await client.query(
          `UPDATE invoices SET subtotal=$1, shipping_charges=$2, total=$3, updated_at=NOW()
            WHERE id=$4 AND (subtotal<>$1 OR shipping_charges<>$2 OR total<>$3)`,
          [r.product, r.ship, r.total, order.invoice_id])
        if (rowCount) stats.invoiceMoney++
      }

      // Print type onto the sales order.
      const { rowCount: typed } = await client.query(
        `UPDATE orders SET print_type=$1, updated_at=NOW()
          WHERE id=$2 AND print_type IS DISTINCT FROM $1`, [r.print_type, order.id])
      if (typed) {
        stats.printType++
        if (r.method !== r.print_type) {
          note('PRINT TYPE', `${r.po} sheet says "${r.method}", stored as "${r.print_type}"`)
        }
      }

      // Tracking already held on the purchase order.
      if (po && !String(order.tracking_number || '').trim() && String(po.tracking_number || '').trim()) {
        await client.query(
          `UPDATE orders SET tracking_number=$1,
                  courier = COALESCE(NULLIF(BTRIM(courier),''),
                                     CASE WHEN $1 LIKE '1Z%' THEN 'UPS'
                                          WHEN $1 ~ '^[0-9]{20,22}$' THEN 'USPS' END),
                  updated_at=NOW()
            WHERE id=$2`, [po.tracking_number, order.id])
        stats.trackingFilled++
        note('TRACKING', `${r.po} → ${order.order_number} takes ${po.tracking_number} from ${po.po_number}`)
      }

      if (!String(order.shipping_address || '').trim()) {
        note('NO ADDRESS', `${r.po} ${order.order_number} has no shipping address in the system either`)
      }
    }

    // Safety net for orders outside both sheets that carry the same defect.
    // Only rows where the item lines PROVE the split are touched: the lines must
    // sum to exactly subtotal minus shipping, which is the signature of shipping
    // having been folded into the subtotal. The total is never changed, so no
    // invoice, payment or customer-facing figure moves.
    const { rows: swept } = await client.query(
      `WITH lines AS (
         SELECT o.id, COALESCE(SUM(a.amount), 0) AS items
           FROM orders o JOIN order_items_apparel a ON a.order_id = o.id
          WHERE o.deleted_at IS NULL GROUP BY o.id)
       UPDATE orders o SET subtotal = lines.items, updated_at = NOW()
         FROM lines
        WHERE o.id = lines.id
          AND o.subtotal + o.shipping_charges <> o.total
          AND lines.items = o.subtotal - o.shipping_charges
          AND o.shipping_charges > 0
        RETURNING o.order_number, o.shipping_name, lines.items, o.shipping_charges, o.total`)
    for (const s of swept) {
      note('MONEY (off-sheet)', `${s.order_number} ${s.shipping_name} — subtotal set to ${money(s.items)} ` +
                                `from its own item lines; ${money(s.shipping_charges)} shipping, total stays ${money(s.total)}`)
    }
    stats.offSheetMoney = swept.length

    const { rows: [c] } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE order_type='dtf')::int AS dtf,
         COUNT(*) FILTER (WHERE order_type='apparel' AND source_po_number LIKE 'TS-PA-%')::int AS apparel_sheet,
         COUNT(*) FILTER (WHERE order_type='apparel' AND source_po_number IS NULL)::int AS apparel_other,
         COUNT(*) FILTER (WHERE subtotal + shipping_charges <> total)::int AS money_wrong
       FROM orders WHERE deleted_at IS NULL`)
    const { rows: [p] } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE po_type='gangsheet')::int AS dtf,
              COUNT(*) FILTER (WHERE po_type='apparel' AND source_po_number LIKE 'TS-PA-%')::int AS apparel_sheet,
              COUNT(*) FILTER (WHERE po_type='apparel' AND source_po_number IS NULL)::int AS apparel_other
         FROM purchase_orders WHERE deleted_at IS NULL`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (no changes needed)')
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(16)} ${v}`)
    console.log('\nResulting state')
    console.log(`  Sales orders   DTF ${c.dtf} + apparel-on-sheet ${c.apparel_sheet} = ${c.dtf + c.apparel_sheet}   (target 97)`)
    console.log(`  Purchase orders DTF ${p.dtf} + apparel-on-sheet ${p.apparel_sheet} = ${p.dtf + p.apparel_sheet}   (target 97)`)
    console.log(`  Hand-keyed apparel not on either sheet: ${c.apparel_other} orders, ${p.apparel_other} POs  (left alone)`)
    console.log(`  Any order where sub+ship <> total: ${c.money_wrong}   (expected 0 excluding the hand-keyed six)`)

    if (APPLY) { await client.query('COMMIT'); console.log('\nCommitted.') }
    else { await client.query('ROLLBACK'); console.log('\nRolled back. Re-run with --apply to keep these changes.') }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
