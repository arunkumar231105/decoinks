#!/usr/bin/env node
/**
 * Move every quotation, invoice and purchase order line into the tables built
 * by migrations 106–115.
 *
 * 836 lines live in three tables that hold one row shape for every kind of
 * product: quotation_items (306), invoice_items (319), purchase_order_items
 * (211). The new tables give each kind its own shape. This copies the lines
 * across. It does not delete anything: the legacy tables stay exactly as they
 * are and keep serving every screen, so the application behaves identically
 * while both sets exist.
 *
 * WHAT DECIDES WHERE A LINE GOES
 *   quotation / invoice   the parent document's order_type — apparel, dtf or
 *                         gangsheet. Every line of a document is of its kind.
 *   purchase order        print_type. 189 lines are DTF Transfers, 22 are
 *                         apparel decoration (Front, Back, Front & Back, DTG).
 *                         size is not the discriminator: three DTG lines and
 *                         one Front line have no size recorded.
 *
 * LINES ON DELETED DOCUMENTS ARE MOVED TOO. 110 of the 306 quotation lines
 * belong to soft-deleted quotations. They are copied like any other, so
 * restoring a document still brings its lines back.
 *
 * WHAT IS NOT INVENTED
 *   style_no stays empty on apparel lines: there is no style column in the
 *   legacy tables and the description is not a style number.
 *   line_discount is 0 on quotation lines, which is what quotation_items
 *   records — it has no discount column at all. Invoice lines carry theirs.
 *   Sizes are copied one to one. The legacy sizes column was expected to hold
 *   "S:10, M:20"; in this data it holds a single size per row already, so
 *   nothing is split and nothing is guessed.
 *
 * PROOF, NOT ASSURANCE. Afterwards every line is counted and every amount is
 * summed on both sides, per table and per document. A single row or a single
 * cent out and the whole thing rolls back.
 *
 * Usage:
 *   node backend/scripts/move-lines-into-the-new-tables.js            (dry-run)
 *   node backend/scripts/move-lines-into-the-new-tables.js --apply
 *   node backend/scripts/move-lines-into-the-new-tables.js --apply --reset
 *       --reset empties the new tables first. Sandbox only; it refuses to run
 *       against a database whose new tables hold rows with no legacy source.
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset')
// No connection string in the source. This runs against whatever DATABASE_URL
// points at, and refuses to run without one — a default here is a database
// password in a public repository, and a default pointing at production is a
// script that writes to it by accident.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess which database to use.')
  process.exit(1)
}

const money = n => `$${Number(n || 0).toFixed(2)}`

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  const one = async (sql, p) => (await client.query(sql, p)).rows[0]

  try {
    const { rows: [db] } = await client.query('SELECT current_database() AS name')
    console.log(`Database: ${db.name}${APPLY ? '' : '   (dry run)'}\n`)

    // ── What is there to move ─────────────────────────────────────────────
    const before = await one(`
      SELECT (SELECT count(*) FROM quotation_items)::int      AS q_lines,
             (SELECT SUM(amount) FROM quotation_items)        AS q_money,
             (SELECT count(*) FROM invoice_items)::int        AS i_lines,
             (SELECT SUM(amount) FROM invoice_items)          AS i_money,
             (SELECT count(*) FROM purchase_order_items)::int AS p_lines,
             (SELECT SUM(line_total) FROM purchase_order_items) AS p_money`)
    console.log('To move:')
    console.log(`  quotation_items       ${String(before.q_lines).padStart(4)} lines   ${money(before.q_money)}`)
    console.log(`  invoice_items         ${String(before.i_lines).padStart(4)} lines   ${money(before.i_money)}`)
    console.log(`  purchase_order_items  ${String(before.p_lines).padStart(4)} lines   ${money(before.p_money)}`)
    console.log(`  ${'─'.repeat(52)}`)
    console.log(`  total                 ${String(before.q_lines + before.i_lines + before.p_lines).padStart(4)} lines\n`)

    // ── Where each line will land ─────────────────────────────────────────
    const { rows: plan } = await client.query(`
      SELECT 'quotation_items_apparel'   AS destination, count(*)::int AS lines, SUM(qi.amount) AS amount
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE q.order_type = 'apparel'
      UNION ALL SELECT 'quotation_items_dtf', count(*)::int, SUM(qi.amount)
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE q.order_type = 'dtf'
      UNION ALL SELECT 'quotation_items_gangsheet', count(*)::int, SUM(qi.amount)
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE q.order_type = 'gangsheet'
      UNION ALL SELECT 'invoice_items_apparel', count(*)::int, SUM(ii.amount)
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_type = 'apparel'
      UNION ALL SELECT 'invoice_items_dtf', count(*)::int, SUM(ii.amount)
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_type = 'dtf'
      UNION ALL SELECT 'invoice_items_gangsheet', count(*)::int, SUM(ii.amount)
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_type = 'gangsheet'
      UNION ALL SELECT 'po_apparel_items', count(*)::int, SUM(line_total)
        FROM purchase_order_items WHERE print_type IS NULL OR print_type NOT ILIKE 'DTF%'
      UNION ALL SELECT 'po_dtf_items', count(*)::int, SUM(line_total)
        FROM purchase_order_items WHERE print_type ILIKE 'DTF%'
      ORDER BY 2 DESC`)
    console.log('Destinations:')
    for (const r of plan) {
      console.log(`  ${r.destination.padEnd(28)} ${String(r.lines).padStart(4)} lines   ${money(r.amount)}`)
    }

    // ── Anything a document points at that has no parent ──────────────────
    const orphan = await one(`
      SELECT (SELECT count(*) FROM quotation_items qi
                WHERE NOT EXISTS (SELECT 1 FROM quotations q WHERE q.id = qi.quotation_id))::int AS q,
             (SELECT count(*) FROM invoice_items ii
                WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = ii.invoice_id))::int AS i,
             (SELECT count(*) FROM purchase_order_items p
                WHERE NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = p.po_id))::int AS p`)
    const orphans = orphan.q + orphan.i + orphan.p
    console.log(`\nLines whose parent document is missing: ${orphans}` +
      (orphans ? `  (quotation ${orphan.q}, invoice ${orphan.i}, PO ${orphan.p}) — these cannot be moved` : '  ✓'))

    const planned = plan.reduce((s, r) => s + r.lines, 0)
    const total = before.q_lines + before.i_lines + before.p_lines
    console.log(`\nAccounted for: ${planned} of ${total} lines` +
      (planned === total ? '  ✓ every line has a destination' : `  ✗ ${total - planned} unaccounted`))
    if (planned !== total) throw new Error('Not every line has a destination — nothing was written.')

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to move the data.')
      return
    }

    await client.query('BEGIN')

    if (RESET) {
      const held = await one(`
        SELECT (SELECT count(*) FROM quotation_items_apparel   WHERE source_quotation_item_id IS NULL)::int +
               (SELECT count(*) FROM quotation_items_dtf       WHERE source_quotation_item_id IS NULL)::int +
               (SELECT count(*) FROM quotation_items_gangsheet WHERE source_quotation_item_id IS NULL)::int +
               (SELECT count(*) FROM invoice_items_apparel     WHERE source_invoice_item_id   IS NULL)::int +
               (SELECT count(*) FROM invoice_items_dtf         WHERE source_invoice_item_id   IS NULL)::int +
               (SELECT count(*) FROM invoice_items_gangsheet   WHERE source_invoice_item_id   IS NULL)::int +
               (SELECT count(*) FROM po_apparel_items          WHERE source_purchase_order_item_id IS NULL)::int +
               (SELECT count(*) FROM po_dtf_items              WHERE source_purchase_order_item_id IS NULL)::int AS n`)
      if (held.n > 0) {
        throw new Error(`--reset refused: ${held.n} row(s) in the new tables were not created by this move. ` +
          'Deleting them would lose data entered through the application.')
      }
      for (const t of ['quotation_items_apparel', 'quotation_items_dtf', 'quotation_items_gangsheet',
        'invoice_items_apparel', 'invoice_items_dtf', 'invoice_items_gangsheet',
        'po_apparel_items', 'po_dtf_items']) {
        await client.query(`DELETE FROM ${t}`)
      }
      console.log('\nCleared the new tables (every row in them came from a previous run of this script).')
    }

    // ── Quotation apparel ─────────────────────────────────────────────────
    // style_no is left empty on purpose: the legacy table has no style column.
    const qa = await client.query(`
      INSERT INTO quotation_items_apparel (
        source_quotation_item_id, quotation_id, line_no, sort_order,
        item_description, color, size, quantity, unit_rate, line_amount,
        unit_of_measure, brand, model, category, decoration_method,
        catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku,
        artwork_count, artwork_no, front_image, back_image, artwork_image)
      SELECT qi.id, qi.quotation_id, COALESCE(qi.line_no, 0), qi.sort_order,
             qi.description, NULLIF(TRIM(qi.colors), ''), NULLIF(TRIM(qi.sizes), ''),
             qi.qty, qi.unit_price, qi.amount,
             UPPER(qi.unit), qi.brand, qi.model, qi.category, qi.decoration_method,
             qi.catalog_style_id, qi.catalog_color_id, qi.catalog_size_id, qi.catalog_sku,
             qi.artwork_count, qi.artwork_no, qi.front_image, qi.back_image, qi.artwork_image
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
       WHERE q.order_type = 'apparel'`)

    // ── Quotation DTF ─────────────────────────────────────────────────────
    const qd = await client.query(`
      INSERT INTO quotation_items_dtf (
        source_quotation_item_id, quotation_id, line_no, sort_order,
        item_description, width_in, height_in, artwork_size, quantity, unit_of_measure,
        unit_rate, line_amount, brand, decoration_method,
        artwork_count, artwork_no, front_image, back_image, artwork_image)
      SELECT qi.id, qi.quotation_id, COALESCE(qi.line_no, 0), qi.sort_order,
             COALESCE(NULLIF(TRIM(qi.description), ''), 'DTF Transfers'),
             qi.artwork_width, qi.artwork_height, NULLIF(TRIM(qi.sizes), ''), qi.qty,
             CASE WHEN UPPER(qi.unit) IN ('PCS','FT') THEN UPPER(qi.unit) ELSE 'PCS' END,
             qi.unit_price, qi.amount, qi.brand, qi.decoration_method,
             qi.artwork_count, qi.artwork_no, qi.front_image, qi.back_image, qi.artwork_image
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
       WHERE q.order_type = 'dtf'`)

    // ── Quotation gangsheet ───────────────────────────────────────────────
    // The description is the sheet: 22" x 60".
    const qg = await client.query(`
      INSERT INTO quotation_items_gangsheet (
        source_quotation_item_id, quotation_id, line_no, sort_order,
        size, item_description, no_artworks, quantity, price_per_sheet, line_amount,
        unit_of_measure, artwork_count, artwork_no, front_image, back_image, artwork_image)
      SELECT qi.id, qi.quotation_id, COALESCE(qi.line_no, 0), qi.sort_order,
             LEFT(COALESCE(NULLIF(TRIM(qi.description), ''), 'Gangsheet'), 50),
             qi.description, GREATEST(COALESCE(qi.artwork_count, 1), 1), qi.qty,
             qi.unit_price, qi.amount,
             UPPER(qi.unit), qi.artwork_count, qi.artwork_no, qi.front_image, qi.back_image, qi.artwork_image
        FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
       WHERE q.order_type = 'gangsheet'`)

    // ── Invoice apparel ───────────────────────────────────────────────────
    const ia = await client.query(`
      INSERT INTO invoice_items_apparel (
        source_invoice_item_id, invoice_id, line_no, sort_order,
        item_description, color, size, quantity, unit_rate, line_discount, line_amount,
        taxable, tax_code, brand, model, category, style_description, product_image,
        catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku,
        artwork_count, artwork_no, front_image, back_image, artwork_image, notes)
      SELECT ii.id, ii.invoice_id, COALESCE(ii.sort_order, 0), ii.sort_order,
             ii.description, NULLIF(TRIM(ii.colors), ''), NULLIF(TRIM(ii.sizes), ''),
             ii.qty::int, ii.unit_price, COALESCE(ii.line_discount, 0), ii.amount,
             COALESCE(ii.taxable, TRUE), ii.tax_code, ii.brand, ii.model, ii.category,
             ii.style_description, ii.product_image,
             ii.catalog_style_id, ii.catalog_color_id, ii.catalog_size_id, ii.catalog_sku,
             ii.artwork_count, ii.artwork_no, ii.front_image, ii.back_image, ii.artwork_image, ii.notes
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.order_type = 'apparel'`)

    // ── Invoice DTF ───────────────────────────────────────────────────────
    const id = await client.query(`
      INSERT INTO invoice_items_dtf (
        source_invoice_item_id, invoice_id, line_no, sort_order,
        item_description, width_in, height_in, artwork_size, quantity, unit_of_measure,
        unit_rate, line_discount, line_amount, taxable, tax_code, brand,
        artwork_count, artwork_no, front_image, back_image, artwork_image, notes)
      SELECT ii.id, ii.invoice_id, COALESCE(ii.sort_order, 0), ii.sort_order,
             COALESCE(NULLIF(TRIM(ii.description), ''), 'DTF Transfers'),
             ii.width_in, ii.height_in, NULLIF(TRIM(ii.sizes), ''), ii.qty::int, 'PCS',
             ii.unit_price, COALESCE(ii.line_discount, 0), ii.amount,
             COALESCE(ii.taxable, TRUE), ii.tax_code, ii.brand,
             ii.artwork_count, ii.artwork_no, ii.front_image, ii.back_image, ii.artwork_image, ii.notes
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.order_type = 'dtf'`)

    // ── Invoice gangsheet ─────────────────────────────────────────────────
    const ig = await client.query(`
      INSERT INTO invoice_items_gangsheet (
        source_invoice_item_id, invoice_id, line_no, sort_order,
        size, item_description, no_artworks, quantity, price_per_sheet,
        line_discount, line_amount, taxable, tax_code,
        artwork_count, artwork_no, front_image, back_image, artwork_image, notes)
      SELECT ii.id, ii.invoice_id, COALESCE(ii.sort_order, 0), ii.sort_order,
             LEFT(COALESCE(NULLIF(TRIM(ii.description), ''), 'Gangsheet'), 50),
             ii.description, GREATEST(COALESCE(ii.artwork_count, 1), 1), ii.qty::int, ii.unit_price,
             COALESCE(ii.line_discount, 0), ii.amount, COALESCE(ii.taxable, TRUE), ii.tax_code,
             ii.artwork_count, ii.artwork_no, ii.front_image, ii.back_image, ii.artwork_image, ii.notes
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.order_type = 'gangsheet'`)

    // ── PO apparel ────────────────────────────────────────────────────────
    // line_no is renumbered per PO: the unique index is (purchase_order_id,
    // line_no) and the legacy sort_order repeats within a document.
    const pa = await client.query(`
      INSERT INTO po_apparel_items (
        source_purchase_order_item_id, purchase_order_id, line_no, sort_order,
        item_name, style_no, item_description, color, size, quantity,
        supplier_unit_cost, supplier_line_cost, uom,
        discount_pct, discount_amt, tax_pct, tax_amt, required_by_date,
        brand, category, decoration_method, print_type, artwork_size,
        source_artwork_no, image_file_ref, front_image, back_image, hsn_code, remarks,
        catalog_style_id, catalog_color_id, catalog_size_id, catalog_sku)
      SELECT p.id, p.po_id,
             ROW_NUMBER() OVER (PARTITION BY p.po_id ORDER BY p.sort_order NULLS LAST, p.created_at, p.id),
             p.sort_order,
             p.item_name, p.catalog_sku, COALESCE(p.description, p.item_name), p.color, p.size,
             GREATEST(p.qty_ordered, 1), p.unit_price, p.line_total, UPPER(p.uom),
             p.discount_pct, p.discount_amt, p.tax_pct, p.tax_amt, p.required_by_date,
             p.brand, p.category, p.print_type, p.print_type, p.artwork_size,
             p.source_artwork_no, p.image_file_ref, p.front_image, p.back_image, p.hsn_code, p.remarks,
             p.catalog_style_id, p.catalog_color_id, p.catalog_size_id, p.catalog_sku
        FROM purchase_order_items p
       WHERE p.print_type IS NULL OR p.print_type NOT ILIKE 'DTF%'`)

    // ── PO DTF ────────────────────────────────────────────────────────────
    const pd = await client.query(`
      INSERT INTO po_dtf_items (
        source_purchase_order_item_id, purchase_order_id, line_no, sort_order,
        item_name, item_description, artwork_size, gangsheet_lengths, print_type,
        brand, category, quantity, uom, supplier_unit_cost, supplier_line_cost,
        discount_pct, discount_amt, tax_pct, tax_amt, required_by_date,
        source_artwork_no, image_file_ref, front_image, back_image, remarks)
      SELECT p.id, p.po_id,
             ROW_NUMBER() OVER (PARTITION BY p.po_id ORDER BY p.sort_order NULLS LAST, p.created_at, p.id),
             p.sort_order,
             p.item_name, p.description, p.artwork_size, p.gangsheet_lengths, p.print_type,
             p.brand, p.category, GREATEST(p.qty_ordered, 1), UPPER(p.uom), p.unit_price, p.line_total,
             p.discount_pct, p.discount_amt, p.tax_pct, p.tax_amt, p.required_by_date,
             p.source_artwork_no, p.image_file_ref, p.front_image, p.back_image, p.remarks
        FROM purchase_order_items p
       WHERE p.print_type ILIKE 'DTF%'`)

    const moved = {
      quotation_items_apparel: qa.rowCount, quotation_items_dtf: qd.rowCount,
      quotation_items_gangsheet: qg.rowCount, invoice_items_apparel: ia.rowCount,
      invoice_items_dtf: id.rowCount, invoice_items_gangsheet: ig.rowCount,
      po_apparel_items: pa.rowCount, po_dtf_items: pd.rowCount,
    }
    console.log('\nMoved:')
    for (const [t, n] of Object.entries(moved)) console.log(`  ${t.padEnd(28)} ${String(n).padStart(4)}`)

    // ══ Proof ════════════════════════════════════════════════════════════
    const problems = []

    // 1. Every legacy line has exactly one new line.
    const unmoved = await one(`
      SELECT (SELECT count(*) FROM quotation_items qi WHERE NOT EXISTS (
                SELECT 1 FROM quotation_items_apparel   a WHERE a.source_quotation_item_id = qi.id
                UNION ALL SELECT 1 FROM quotation_items_dtf       d WHERE d.source_quotation_item_id = qi.id
                UNION ALL SELECT 1 FROM quotation_items_gangsheet g WHERE g.source_quotation_item_id = qi.id))::int AS q,
             (SELECT count(*) FROM invoice_items ii WHERE NOT EXISTS (
                SELECT 1 FROM invoice_items_apparel   a WHERE a.source_invoice_item_id = ii.id
                UNION ALL SELECT 1 FROM invoice_items_dtf       d WHERE d.source_invoice_item_id = ii.id
                UNION ALL SELECT 1 FROM invoice_items_gangsheet g WHERE g.source_invoice_item_id = ii.id))::int AS i,
             (SELECT count(*) FROM purchase_order_items p WHERE NOT EXISTS (
                SELECT 1 FROM po_apparel_items a WHERE a.source_purchase_order_item_id = p.id
                UNION ALL SELECT 1 FROM po_dtf_items d WHERE d.source_purchase_order_item_id = p.id))::int AS p`)
    console.log('\nProof:')
    console.log(`  legacy lines with no new line:   quotation ${unmoved.q}, invoice ${unmoved.i}, PO ${unmoved.p}` +
      (unmoved.q + unmoved.i + unmoved.p === 0 ? '   ✓' : '   ✗'))
    if (unmoved.q + unmoved.i + unmoved.p > 0) problems.push('some legacy lines were not moved')

    // 2. The money adds up, table by table.
    const cash = await one(`
      SELECT (SELECT SUM(amount) FROM quotation_items) AS q_old,
             (SELECT COALESCE((SELECT SUM(line_amount) FROM quotation_items_apparel), 0)
                   + COALESCE((SELECT SUM(line_amount) FROM quotation_items_dtf), 0)
                   + COALESCE((SELECT SUM(line_amount) FROM quotation_items_gangsheet), 0)) AS q_new,
             (SELECT SUM(amount) FROM invoice_items) AS i_old,
             (SELECT COALESCE((SELECT SUM(line_amount) FROM invoice_items_apparel), 0)
                   + COALESCE((SELECT SUM(line_amount) FROM invoice_items_dtf), 0)
                   + COALESCE((SELECT SUM(line_amount) FROM invoice_items_gangsheet), 0)) AS i_new,
             (SELECT SUM(line_total) FROM purchase_order_items) AS p_old,
             (SELECT COALESCE((SELECT SUM(supplier_line_cost) FROM po_apparel_items), 0)
                   + COALESCE((SELECT SUM(supplier_line_cost) FROM po_dtf_items), 0)) AS p_new`)
    for (const [label, o, n] of [['quotations', cash.q_old, cash.q_new],
      ['invoices', cash.i_old, cash.i_new], ['purchase orders', cash.p_old, cash.p_new]]) {
      const same = Number(o || 0).toFixed(2) === Number(n || 0).toFixed(2)
      console.log(`  ${label.padEnd(32)} ${money(o)} → ${money(n)}` + (same ? '   ✓' : '   ✗'))
      if (!same) problems.push(`${label} money does not match`)
    }

    // 3. Quantities add up too — a line is not just its price.
    const qtys = await one(`
      SELECT (SELECT SUM(qty) FROM quotation_items) AS q_old,
             (SELECT COALESCE((SELECT SUM(quantity) FROM quotation_items_apparel), 0)
                   + COALESCE((SELECT SUM(quantity) FROM quotation_items_dtf), 0)
                   + COALESCE((SELECT SUM(quantity) FROM quotation_items_gangsheet), 0)) AS q_new,
             (SELECT SUM(qty) FROM invoice_items) AS i_old,
             (SELECT COALESCE((SELECT SUM(quantity) FROM invoice_items_apparel), 0)
                   + COALESCE((SELECT SUM(quantity) FROM invoice_items_dtf), 0)
                   + COALESCE((SELECT SUM(quantity) FROM invoice_items_gangsheet), 0)) AS i_new,
             (SELECT SUM(qty_ordered) FROM purchase_order_items) AS p_old,
             (SELECT COALESCE((SELECT SUM(quantity) FROM po_apparel_items), 0)
                   + COALESCE((SELECT SUM(quantity) FROM po_dtf_items), 0)) AS p_new`)
    for (const [label, o, n] of [['quotation pieces', qtys.q_old, qtys.q_new],
      ['invoice pieces', qtys.i_old, qtys.i_new], ['PO pieces', qtys.p_old, qtys.p_new]]) {
      const same = Number(o || 0) === Number(n || 0)
      console.log(`  ${label.padEnd(32)} ${Number(o || 0)} → ${Number(n || 0)}` + (same ? '   ✓' : '   ✗'))
      if (!same) problems.push(`${label} do not match`)
    }

    // 4. Per document, not just in total — an error that cancels out is still an error.
    const perDoc = await one(`
      WITH q AS (
        SELECT qi.quotation_id AS doc, SUM(qi.amount) AS old FROM quotation_items qi GROUP BY 1),
      qn AS (
        SELECT doc, SUM(amt) AS new FROM (
          SELECT quotation_id AS doc, line_amount AS amt FROM quotation_items_apparel
          UNION ALL SELECT quotation_id, line_amount FROM quotation_items_dtf
          UNION ALL SELECT quotation_id, line_amount FROM quotation_items_gangsheet) x GROUP BY 1),
      i AS (SELECT ii.invoice_id AS doc, SUM(ii.amount) AS old FROM invoice_items ii GROUP BY 1),
      inew AS (
        SELECT doc, SUM(amt) AS new FROM (
          SELECT invoice_id AS doc, line_amount AS amt FROM invoice_items_apparel
          UNION ALL SELECT invoice_id, line_amount FROM invoice_items_dtf
          UNION ALL SELECT invoice_id, line_amount FROM invoice_items_gangsheet) x GROUP BY 1)
      SELECT (SELECT count(*) FROM q FULL JOIN qn ON q.doc = qn.doc
                WHERE COALESCE(q.old, -1) <> COALESCE(qn.new, -1))::int AS q_off,
             (SELECT count(*) FROM i FULL JOIN inew ON i.doc = inew.doc
                WHERE COALESCE(i.old, -1) <> COALESCE(inew.new, -1))::int AS i_off`)
    console.log(`  documents whose total changed:   quotations ${perDoc.q_off}, invoices ${perDoc.i_off}` +
      (perDoc.q_off + perDoc.i_off === 0 ? '   ✓' : '   ✗'))
    if (perDoc.q_off + perDoc.i_off > 0) problems.push('some documents changed total')

    if (problems.length) {
      await client.query('ROLLBACK')
      console.log(`\nROLLED BACK — nothing was written.`)
      problems.forEach(p => console.log(`  ✗ ${p}`))
      process.exitCode = 1
      return
    }

    await client.query('COMMIT')
    console.log(`\nCommitted. ${Object.values(moved).reduce((a, b) => a + b, 0)} lines moved, ` +
      'every count and every amount reconciled. The legacy tables are untouched.')
  } catch (err) {
    if (APPLY) { try { await client.query('ROLLBACK') } catch { /* no tx */ } }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1) })
