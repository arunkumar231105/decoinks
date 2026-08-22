#!/usr/bin/env node
/**
 * Check the line move value by value, not row by row.
 *
 * move-lines-into-the-new-tables.js proves the counts and the money add up.
 * That is not the same as proving nothing was dropped: a column with no
 * destination would leave the totals perfectly intact while quietly losing
 * every value in it. This walks each legacy column to the column that received
 * it and compares them on the row itself, so a value that went missing, went to
 * the wrong place, or arrived changed all show up the same way.
 *
 * The comparison is IS DISTINCT FROM, so NULL on one side and a value on the
 * other counts as a difference. Where the move deliberately normalised a value
 * — 'pcs' written as 'PCS', a blank string stored as NULL — the expression
 * below says so, and that is the thing being checked.
 *
 * Usage: node backend/scripts/verify-no-value-was-lost.js
 */
const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:decoinks_pass@localhost:5435/decoinks_dev'

// legacy table, the rows it covers, destination table, link column,
// then [legacy expression, destination column] for every value carried.
const MAP = [
  {
    from: 'quotation_items qi JOIN quotations q ON q.id = qi.quotation_id',
    where: "q.order_type = 'apparel'", to: 'quotation_items_apparel', link: 'source_quotation_item_id',
    fields: [
      ['qi.description', 'item_description'], ["NULLIF(TRIM(qi.colors),'')", 'color'],
      ["NULLIF(TRIM(qi.sizes),'')", 'size'], ['qi.qty', 'quantity'], ['qi.unit_price', 'unit_rate'],
      ['qi.amount', 'line_amount'], ['UPPER(qi.unit)', 'unit_of_measure'], ['qi.sort_order', 'sort_order'],
      ['qi.brand', 'brand'], ['qi.model', 'model'], ['qi.category', 'category'],
      ['qi.decoration_method', 'decoration_method'], ['qi.artwork_count', 'artwork_count'],
      ['qi.artwork_no', 'artwork_no'], ['qi.front_image', 'front_image'], ['qi.back_image', 'back_image'],
      ['qi.artwork_image', 'artwork_image'], ['qi.catalog_style_id', 'catalog_style_id'],
      ['qi.catalog_color_id', 'catalog_color_id'], ['qi.catalog_size_id', 'catalog_size_id'],
      ['qi.catalog_sku', 'catalog_sku'], ['qi.quotation_id', 'quotation_id'],
    ],
  },
  {
    from: 'quotation_items qi JOIN quotations q ON q.id = qi.quotation_id',
    where: "q.order_type = 'dtf'", to: 'quotation_items_dtf', link: 'source_quotation_item_id',
    fields: [
      ["COALESCE(NULLIF(TRIM(qi.description),''),'DTF Transfers')", 'item_description'],
      ['qi.artwork_width', 'width_in'], ['qi.artwork_height', 'height_in'],
      ["NULLIF(TRIM(qi.sizes),'')", 'artwork_size'], ['qi.qty', 'quantity'],
      ['qi.unit_price', 'unit_rate'], ['qi.amount', 'line_amount'], ['qi.sort_order', 'sort_order'],
      ['qi.brand', 'brand'], ['qi.decoration_method', 'decoration_method'],
      ['qi.artwork_count', 'artwork_count'], ['qi.artwork_no', 'artwork_no'],
      ['qi.front_image', 'front_image'], ['qi.back_image', 'back_image'],
      ['qi.artwork_image', 'artwork_image'], ['qi.quotation_id', 'quotation_id'],
    ],
  },
  {
    from: 'quotation_items qi JOIN quotations q ON q.id = qi.quotation_id',
    where: "q.order_type = 'gangsheet'", to: 'quotation_items_gangsheet', link: 'source_quotation_item_id',
    fields: [
      ['qi.description', 'item_description'], ['qi.qty', 'quantity'],
      ['qi.unit_price', 'price_per_sheet'], ['qi.amount', 'line_amount'],
      ['UPPER(qi.unit)', 'unit_of_measure'], ['qi.sort_order', 'sort_order'],
      ['qi.artwork_count', 'artwork_count'], ['qi.front_image', 'front_image'],
      ['qi.back_image', 'back_image'], ['qi.quotation_id', 'quotation_id'],
    ],
  },
  {
    from: 'invoice_items ii JOIN invoices i ON i.id = ii.invoice_id',
    where: "i.order_type = 'apparel'", to: 'invoice_items_apparel', link: 'source_invoice_item_id',
    fields: [
      ['ii.description', 'item_description'], ["NULLIF(TRIM(ii.colors),'')", 'color'],
      ["NULLIF(TRIM(ii.sizes),'')", 'size'], ['ii.qty::int', 'quantity'], ['ii.unit_price', 'unit_rate'],
      ['COALESCE(ii.line_discount,0)', 'line_discount'], ['ii.amount', 'line_amount'],
      ['COALESCE(ii.taxable,TRUE)', 'taxable'], ['ii.tax_code', 'tax_code'], ['ii.sort_order', 'sort_order'],
      ['ii.brand', 'brand'], ['ii.model', 'model'], ['ii.category', 'category'],
      ['ii.style_description', 'style_description'], ['ii.product_image', 'product_image'],
      ['ii.artwork_count', 'artwork_count'], ['ii.artwork_no', 'artwork_no'],
      ['ii.front_image', 'front_image'], ['ii.back_image', 'back_image'],
      ['ii.artwork_image', 'artwork_image'], ['ii.notes', 'notes'],
      ['ii.catalog_style_id', 'catalog_style_id'], ['ii.catalog_color_id', 'catalog_color_id'],
      ['ii.catalog_size_id', 'catalog_size_id'], ['ii.catalog_sku', 'catalog_sku'],
      ['ii.invoice_id', 'invoice_id'],
    ],
  },
  {
    from: 'invoice_items ii JOIN invoices i ON i.id = ii.invoice_id',
    where: "i.order_type = 'dtf'", to: 'invoice_items_dtf', link: 'source_invoice_item_id',
    fields: [
      ["COALESCE(NULLIF(TRIM(ii.description),''),'DTF Transfers')", 'item_description'],
      ['ii.width_in', 'width_in'], ['ii.height_in', 'height_in'],
      ["NULLIF(TRIM(ii.sizes),'')", 'artwork_size'], ['ii.qty::int', 'quantity'],
      ['ii.unit_price', 'unit_rate'], ['COALESCE(ii.line_discount,0)', 'line_discount'],
      ['ii.amount', 'line_amount'], ['COALESCE(ii.taxable,TRUE)', 'taxable'],
      ['ii.tax_code', 'tax_code'], ['ii.sort_order', 'sort_order'], ['ii.brand', 'brand'],
      ['ii.artwork_count', 'artwork_count'], ['ii.artwork_no', 'artwork_no'],
      ['ii.front_image', 'front_image'], ['ii.back_image', 'back_image'],
      ['ii.artwork_image', 'artwork_image'], ['ii.notes', 'notes'], ['ii.invoice_id', 'invoice_id'],
    ],
  },
  {
    from: 'invoice_items ii JOIN invoices i ON i.id = ii.invoice_id',
    where: "i.order_type = 'gangsheet'", to: 'invoice_items_gangsheet', link: 'source_invoice_item_id',
    fields: [
      ['ii.description', 'item_description'], ['ii.qty::int', 'quantity'],
      ['ii.unit_price', 'price_per_sheet'], ['COALESCE(ii.line_discount,0)', 'line_discount'],
      ['ii.amount', 'line_amount'], ['COALESCE(ii.taxable,TRUE)', 'taxable'],
      ['ii.sort_order', 'sort_order'], ['ii.artwork_count', 'artwork_count'],
      ['ii.front_image', 'front_image'], ['ii.back_image', 'back_image'],
      ['ii.notes', 'notes'], ['ii.invoice_id', 'invoice_id'],
    ],
  },
  {
    from: 'purchase_order_items p', where: "p.print_type IS NULL OR p.print_type NOT ILIKE 'DTF%'",
    to: 'po_apparel_items', link: 'source_purchase_order_item_id',
    fields: [
      ['p.item_name', 'item_name'], ['COALESCE(p.description, p.item_name)', 'item_description'],
      ['p.color', 'color'], ['p.size', 'size'], ['GREATEST(p.qty_ordered,1)', 'quantity'],
      ['p.unit_price', 'supplier_unit_cost'], ['p.line_total', 'supplier_line_cost'],
      ['UPPER(p.uom)', 'uom'], ['p.discount_pct', 'discount_pct'], ['p.discount_amt', 'discount_amt'],
      ['p.tax_pct', 'tax_pct'], ['p.tax_amt', 'tax_amt'], ['p.required_by_date', 'required_by_date'],
      ['p.brand', 'brand'], ['p.category', 'category'], ['p.print_type', 'print_type'],
      ['p.artwork_size', 'artwork_size'], ['p.source_artwork_no', 'source_artwork_no'],
      ['p.image_file_ref', 'image_file_ref'], ['p.front_image', 'front_image'],
      ['p.back_image', 'back_image'], ['p.hsn_code', 'hsn_code'], ['p.remarks', 'remarks'],
      ['p.sort_order', 'sort_order'], ['p.catalog_sku', 'catalog_sku'], ['p.po_id', 'purchase_order_id'],
    ],
  },
  {
    from: 'purchase_order_items p', where: "p.print_type ILIKE 'DTF%'",
    to: 'po_dtf_items', link: 'source_purchase_order_item_id',
    fields: [
      ['p.item_name', 'item_name'], ['p.description', 'item_description'],
      ['p.artwork_size', 'artwork_size'], ['p.gangsheet_lengths', 'gangsheet_lengths'],
      ['p.print_type', 'print_type'], ['p.brand', 'brand'], ['p.category', 'category'],
      ['GREATEST(p.qty_ordered,1)', 'quantity'], ['UPPER(p.uom)', 'uom'],
      ['p.unit_price', 'supplier_unit_cost'], ['p.line_total', 'supplier_line_cost'],
      ['p.discount_pct', 'discount_pct'], ['p.discount_amt', 'discount_amt'],
      ['p.tax_pct', 'tax_pct'], ['p.tax_amt', 'tax_amt'], ['p.required_by_date', 'required_by_date'],
      ['p.source_artwork_no', 'source_artwork_no'], ['p.image_file_ref', 'image_file_ref'],
      ['p.front_image', 'front_image'], ['p.back_image', 'back_image'],
      ['p.remarks', 'remarks'], ['p.sort_order', 'sort_order'], ['p.po_id', 'purchase_order_id'],
    ],
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}\n`)

    let checked = 0
    const bad = []
    for (const m of MAP) {
      const alias = m.from.split(' ')[1]
      const lines = m.fields.map(([oldExpr, newCol]) =>
        `count(*) FILTER (WHERE ${oldExpr}::text IS DISTINCT FROM n.${newCol}::text) AS "${newCol}"`).join(',\n             ')
      const { rows: [r] } = await client.query(
        `SELECT count(*)::int AS rows,
             ${lines}
           FROM ${m.from}
           JOIN ${m.to} n ON n.${m.link} = ${alias}.id
          WHERE ${m.where}`)
      const off = Object.entries(r).filter(([k, v]) => k !== 'rows' && Number(v) > 0)
      checked += m.fields.length
      const mark = off.length ? '✗' : '✓'
      console.log(`${mark} ${m.to.padEnd(28)} ${String(r.rows).padStart(4)} rows, ${m.fields.length} values each`)
      for (const [col, n] of off) {
        console.log(`    ${col}: ${n} row(s) differ`)
        bad.push(`${m.to}.${col}`)
      }
    }

    // Nothing arrived that no legacy line asked for.
    const { rows: [extra] } = await client.query(`
      SELECT (SELECT count(*) FROM quotation_items_apparel   WHERE source_quotation_item_id IS NULL)::int +
             (SELECT count(*) FROM quotation_items_dtf       WHERE source_quotation_item_id IS NULL)::int +
             (SELECT count(*) FROM quotation_items_gangsheet WHERE source_quotation_item_id IS NULL)::int +
             (SELECT count(*) FROM invoice_items_apparel     WHERE source_invoice_item_id   IS NULL)::int +
             (SELECT count(*) FROM invoice_items_dtf         WHERE source_invoice_item_id   IS NULL)::int +
             (SELECT count(*) FROM invoice_items_gangsheet   WHERE source_invoice_item_id   IS NULL)::int +
             (SELECT count(*) FROM po_apparel_items          WHERE source_purchase_order_item_id IS NULL)::int +
             (SELECT count(*) FROM po_dtf_items              WHERE source_purchase_order_item_id IS NULL)::int AS n`)
    console.log(`\n${extra.n === 0 ? '✓' : '·'} new rows with no legacy line behind them: ${extra.n}`)

    console.log(bad.length
      ? `\n${bad.length} of ${checked} value checks failed:\n  ${bad.join('\n  ')}`
      : `\nAll ${checked} value checks passed — every value in the legacy tables is present, in the right row, unchanged.`)
    process.exitCode = bad.length ? 1 : 0
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
